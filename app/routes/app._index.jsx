import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import {
  DEFAULT_RULES,
  DEFAULT_RULES_SCRIPT,
  compileRulesScript,
  prettyJson,
} from "../shipping-rules/compiler.server";
import { authenticate } from "../shopify.server";

const CONFIG_NAMESPACE = "$app:hh-delivery-customization";
const CONFIG_KEY = "function-configuration";
const DELIVERY_CUSTOMIZATION_TITLE = "HH delivery customization POC";
const SHIPPING_DISCOUNT_NAMESPACE = "$app:hh-shipping-discount";
const SHIPPING_DISCOUNT_TITLE = "HH shipping discounts POC";
const CHECKOUT_VALIDATION_NAMESPACE = "$app:hh-checkout-validation";
const CHECKOUT_VALIDATION_TITLE = "HH checkout validation POC";
const CHECKOUT_UI_NAMESPACE = "$app:hh-checkout-ui";

function assertNoGraphqlErrors(json) {
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
}

async function getDeliveryCustomizationId(admin) {
  const preferred = await getDeliveryCustomizationStatus(admin);

  if (!preferred) {
    throw new Error(`Delivery customization "${DELIVERY_CUSTOMIZATION_TITLE}" does not exist. Create or activate it before publishing rules.`);
  }

  return preferred.id;
}

async function getDeliveryCustomizationStatus(admin) {
  const response = await admin.graphql(`#graphql
    query DeliveryCustomizationsForConfig {
      deliveryCustomizations(first: 25) {
        nodes {
          id
          title
          enabled
          metafield(namespace: "$app:hh-delivery-customization", key: "function-configuration") {
            id
          }
        }
      }
    }
  `);
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const nodes = json.data?.deliveryCustomizations?.nodes ?? [];
  return nodes.find((node) => node.title === DELIVERY_CUSTOMIZATION_TITLE) ?? null;
}

async function publishDeliveryConfig(admin, config) {
  const ownerId = await getDeliveryCustomizationId(admin);
  const response = await admin.graphql(
    `#graphql
      mutation PublishShippingRules($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: CONFIG_NAMESPACE,
            key: CONFIG_KEY,
            type: "json",
            value: JSON.stringify(config),
          },
        ],
      },
    },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}

function shippingDiscountInput(config) {
  return {
    title: SHIPPING_DISCOUNT_TITLE,
    functionHandle: "hh-shipping-discount",
    discountClasses: ["SHIPPING"],
    startsAt: new Date().toISOString(),
    appliesOnOneTimePurchase: true,
    appliesOnSubscription: true,
    combinesWith: {
      orderDiscounts: true,
      productDiscounts: true,
      shippingDiscounts: false,
    },
    metafields: [
      {
        namespace: SHIPPING_DISCOUNT_NAMESPACE,
        key: CONFIG_KEY,
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  };
}

async function getShippingDiscountStatus(admin) {
  const response = await admin.graphql(`#graphql
    query ExistingShippingDiscounts {
      discountNodes(first: 25, query: "type:app AND method:automatic") {
        nodes {
          discount {
            __typename
            ... on DiscountAutomaticApp {
              discountId
              title
              status
              appDiscountType {
                functionId
                title
              }
            }
          }
        }
      }
    }
  `);
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const nodes = json.data?.discountNodes?.nodes ?? [];
  const match = nodes.find((node) => node.discount?.title === SHIPPING_DISCOUNT_TITLE);
  return match?.discount ?? null;
}

async function publishShippingDiscountConfig(admin, config) {
  if (!Array.isArray(config.shippingDiscounts) || config.shippingDiscounts.length === 0) {
    await deactivateShippingDiscount(admin);
    return;
  }

  const existing = await getShippingDiscountStatus(admin);
  const existingId = existing?.discountId ?? null;
  const automaticAppDiscount = shippingDiscountInput(config);
  const mutation = existingId
    ? `#graphql
      mutation UpdateShippingDiscount($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount {
            title
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `
    : `#graphql
      mutation CreateShippingDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount {
            title
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

  const response = await admin.graphql(mutation, {
    variables: existingId ? { id: existingId, automaticAppDiscount } : { automaticAppDiscount },
  });
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const payload = existingId ? json.data?.discountAutomaticAppUpdate : json.data?.discountAutomaticAppCreate;
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}

async function deactivateShippingDiscount(admin) {
  const existing = await getShippingDiscountStatus(admin);
  if (!existing?.discountId || existing.status !== "ACTIVE") return;

  const response = await admin.graphql(
    `#graphql
      mutation DeactivateShippingDiscount($id: ID!) {
        discountAutomaticDeactivate(id: $id) {
          automaticDiscountNode {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: { id: existing.discountId },
    },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const errors = json.data?.discountAutomaticDeactivate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}

function checkoutValidationInput(config) {
  return {
    title: CHECKOUT_VALIDATION_TITLE,
    enable: true,
    blockOnFailure: true,
    metafields: [
      {
        namespace: CHECKOUT_VALIDATION_NAMESPACE,
        key: CONFIG_KEY,
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  };
}

async function getCheckoutValidationStatus(admin) {
  const response = await admin.graphql(`#graphql
    query ExistingCheckoutValidations {
      validations(first: 25) {
        nodes {
          id
          title
          enabled
          metafield(namespace: "$app:hh-checkout-validation", key: "function-configuration") {
            id
          }
        }
      }
    }
  `);
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const nodes = json.data?.validations?.nodes ?? [];
  return nodes.find((node) => node.title === CHECKOUT_VALIDATION_TITLE) ?? null;
}

async function publishCheckoutValidationConfig(admin, config) {
  if (!Array.isArray(config.validations) || config.validations.length === 0) {
    await disableCheckoutValidation(admin);
    return;
  }

  const existing = await getCheckoutValidationStatus(admin);
  const validation = checkoutValidationInput(config);
  const mutation = existing?.id
    ? `#graphql
      mutation UpdateCheckoutValidation($id: ID!, $validation: ValidationUpdateInput!) {
        validationUpdate(id: $id, validation: $validation) {
          validation {
            id
            title
            enabled
          }
          userErrors {
            field
            message
          }
        }
      }
    `
    : `#graphql
      mutation CreateCheckoutValidation($validation: ValidationCreateInput!) {
        validationCreate(validation: $validation) {
          validation {
            id
            title
            enabled
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

  const response = await admin.graphql(mutation, {
    variables: existing?.id
      ? { id: existing.id, validation }
      : { validation: { ...validation, functionHandle: "hh-checkout-validation" } },
  });
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const payload = existing?.id ? json.data?.validationUpdate : json.data?.validationCreate;
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}

async function disableCheckoutValidation(admin) {
  const existing = await getCheckoutValidationStatus(admin);
  if (!existing?.id || !existing.enabled) return;

  const response = await admin.graphql(
    `#graphql
      mutation DisableCheckoutValidation($id: ID!, $validation: ValidationUpdateInput!) {
        validationUpdate(id: $id, validation: $validation) {
          validation {
            id
            title
            enabled
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        id: existing.id,
        validation: {
          enable: false,
        },
      },
    },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const errors = json.data?.validationUpdate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}

async function publishCheckoutUiConfig(admin, config) {
  const installationResponse = await admin.graphql(`#graphql
    query CurrentAppInstallationForCheckoutUiConfig {
      currentAppInstallation {
        id
      }
    }
  `);
  const installationJson = await installationResponse.json();
  assertNoGraphqlErrors(installationJson);
  const ownerId = installationJson.data?.currentAppInstallation?.id;
  if (!ownerId) {
    throw new Error("Could not find the current app installation to publish checkout UI messages.");
  }

  const response = await admin.graphql(
    `#graphql
      mutation PublishCheckoutUiConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: CHECKOUT_UI_NAMESPACE,
            key: CONFIG_KEY,
            type: "json",
            value: JSON.stringify(config),
          },
        ],
      },
    },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}

function compileForServer(source) {
  try {
    return { ok: true, ...compileRulesScript(source) };
  } catch (error) {
    return { ok: false, message: error.message, json: "" };
  }
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const config = await db.shippingRulesConfig.upsert({
    where: { shop: session.shop },
    update: {},
    create: {
      shop: session.shop,
      rulesScript: DEFAULT_RULES_SCRIPT,
      rulesJson: prettyJson(DEFAULT_RULES),
    },
  });

  const rulesScript = config.rulesScript ?? DEFAULT_RULES_SCRIPT;
  const compiled = compileForServer(rulesScript);
  const rulesJson = compiled.ok ? compiled.json : config.rulesJson;

  if (!config.rulesScript) {
    await db.shippingRulesConfig.update({
      where: { shop: session.shop },
      data: { rulesScript, rulesJson },
    });
  }

  return {
    shop: session.shop,
    rulesScript,
    rulesJson,
    publishedJson: config.publishedJson,
    deliveryCustomizationStatus: await getDeliveryCustomizationStatus(admin),
    shippingDiscountStatus: await getShippingDiscountStatus(admin),
    checkoutValidationStatus: await getCheckoutValidationStatus(admin),
    updatedAt: config.updatedAt,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const rulesScript = String(formData.get("rulesScript") ?? "");

  let compiled;
  try {
    compiled = compileRulesScript(rulesScript);
  } catch (error) {
    return { ok: false, message: error.message };
  }

  await db.shippingRulesConfig.upsert({
    where: { shop: session.shop },
    update: {
      rulesScript,
      rulesJson: compiled.json,
    },
    create: {
      shop: session.shop,
      rulesScript,
      rulesJson: compiled.json,
    },
  });

  if (intent !== "publish") {
    return { ok: false, message: "Use Save and publish to update checkout." };
  }

  try {
    await publishDeliveryConfig(admin, compiled.config);
    await publishShippingDiscountConfig(admin, compiled.config);
    await publishCheckoutValidationConfig(admin, compiled.config);
    await publishCheckoutUiConfig(admin, compiled.config);
    await db.shippingRulesConfig.update({
      where: { shop: session.shop },
      data: { publishedJson: compiled.json },
    });
  } catch (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Rules compiled, saved, and published to checkout." };
};

function highlightJson(json) {
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
  const parts = [];
  let lastIndex = 0;

  for (const match of json.matchAll(tokenPattern)) {
    if (match.index > lastIndex) parts.push(json.slice(lastIndex, match.index));

    const [token, key, string, literal, number] = match;
    const color = key ? "#0550ae" : string ? "#0a7f3f" : literal ? "#cf222e" : number ? "#953800" : "inherit";
    parts.push(
      <span key={`${match.index}-${token}`} style={{ color }}>
        {token}
      </span>,
    );
    lastIndex = match.index + token.length;
  }

  parts.push(json.slice(lastIndex));
  return parts;
}

function highlightDsl(source) {
  const tokenPattern =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(settings|campaigns|HideRates|ShippingDiscount|CartValidation|CodeQualifier|NoDiscountCodeQualifier|CartSubtotalQualifier|CartQuantityQualifier|CartHasItemQualifier|CountryCodeQualifier|ProductTagSelector|RateNameSelector|AllRatesSelector|PercentageDiscount|FixedAmountDiscount)\b|\b(name|condition|qualifiers|rateSelector|discount|match|codes|names|amount|percent|message|message_title|messageTitle|target|comparison|selector|tags|productTags|countryCodes|enabled)\b(?=\s*:)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
  const parts = [];
  let lastIndex = 0;

  for (const match of source.matchAll(tokenPattern)) {
    if (match.index > lastIndex) parts.push(source.slice(lastIndex, match.index));

    const [token, comment, string, helper, key, literal, number] = match;
    const color = comment
      ? "#6a737d"
      : string
        ? "#0a7f3f"
        : helper
          ? "#cf222e"
          : key
            ? "#0550ae"
            : literal
              ? "#cf222e"
              : number
                ? "#953800"
                : "inherit";

    parts.push(
      <span key={`${match.index}-${token}`} style={{ color, fontWeight: helper ? 600 : 400 }}>
        {token}
      </span>,
    );
    lastIndex = match.index + token.length;
  }

  parts.push(source.slice(lastIndex));
  return parts;
}

function DslEditor({ value, onChange }) {
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const textareaRef = useRef(null);

  return (
    <div
      style={{
        background: "#fbfbfb",
        border: "1px solid #c9cccf",
        borderRadius: 6,
        boxSizing: "border-box",
        minHeight: 520,
        position: "relative",
        width: "100%",
      }}
    >
      <pre
        aria-hidden="true"
        style={{
          boxSizing: "border-box",
          color: "#1f2124",
          fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          fontSize: 13,
          inset: 0,
          lineHeight: 1.5,
          margin: 0,
          overflow: "hidden",
          padding: 16,
          pointerEvents: "none",
          position: "absolute",
          whiteSpace: "pre",
        }}
      >
        <span style={{ display: "inline-block", transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
          {highlightDsl(value)}
        </span>
      </pre>
      <textarea
        ref={textareaRef}
        name="rulesScript"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) =>
          setScroll({
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          })
        }
        spellCheck="false"
        style={{
          background: "transparent",
          border: 0,
          boxSizing: "border-box",
          caretColor: "#1f2124",
          color: "transparent",
          fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          fontSize: 13,
          inset: 0,
          lineHeight: 1.5,
          margin: 0,
          minHeight: 520,
          outline: "none",
          overflow: "auto",
          padding: 16,
          position: "absolute",
          resize: "vertical",
          whiteSpace: "pre",
          width: "100%",
        }}
      />
    </div>
  );
}

export default function Index() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [rulesScript, setRulesScript] = useState(loaderData.rulesScript);

  const isSubmitting = navigation.state === "submitting";
  const hasLocalChanges = rulesScript !== loaderData.rulesScript;
  const compiledCounts = useMemo(() => {
    try {
      const parsed = JSON.parse(loaderData.rulesJson);
      return {
        hideRules: parsed.rules?.length ?? 0,
        shippingDiscounts: parsed.shippingDiscounts?.length ?? 0,
        validations: parsed.validations?.length ?? 0,
      };
    } catch {
      return { hideRules: 0, shippingDiscounts: 0, validations: 0 };
    }
  }, [loaderData.rulesJson]);
  const previewJson = loaderData.rulesJson;

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message, {
        isError: !actionData.ok,
      });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Shipping Rules">
      <s-section heading="Campaign script">
        <s-stack gap="base">
          <s-paragraph>
            Editing rules for <s-text type="emphasis">{loaderData.shop}</s-text>. This script is intentionally small:
            campaigns create hide-rate rules, qualifiers decide when they apply, and rate selectors decide which delivery
            options are hidden.
          </s-paragraph>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-text>Hide rules: {compiledCounts.hideRules}</s-text>
              <s-text>Shipping discounts: {compiledCounts.shippingDiscounts}</s-text>
              <s-text>Validations: {compiledCounts.validations}</s-text>
              <s-text>
                Delivery config: {loaderData.deliveryCustomizationStatus?.metafield ? "published" : "missing"}
              </s-text>
              <s-text>
                Discount function: {loaderData.shippingDiscountStatus?.status ?? "not active"}
              </s-text>
              <s-text>
                Validation: {loaderData.checkoutValidationStatus?.enabled ? "active" : "not active"}
              </s-text>
              <s-text>Unsaved changes: {hasLocalChanges ? "yes" : "no"}</s-text>
              <s-text>Published: {loaderData.publishedJson ? "yes" : "not yet"}</s-text>
            </s-stack>
          </s-box>

          {compiledCounts.shippingDiscounts > 0 && !loaderData.shippingDiscountStatus ? (
            <s-banner tone="warning" heading="Shipping discount is not active">
              <s-paragraph>
                Publish to checkout to create the automatic app discount that invokes the HH Shipping Discount
                function.
              </s-paragraph>
            </s-banner>
          ) : null}

          {compiledCounts.validations > 0 && !loaderData.checkoutValidationStatus?.enabled ? (
            <s-banner tone="warning" heading="Checkout validation is not active">
              <s-paragraph>
                Save and publish to create the checkout validation that shows blocking customer messages.
              </s-paragraph>
            </s-banner>
          ) : null}

          {!loaderData.deliveryCustomizationStatus?.metafield ? (
            <s-banner tone="warning" heading="Delivery customization config is missing">
              <s-paragraph>
                Checkout is using no published delivery config. Publish to checkout before testing changes.
              </s-paragraph>
            </s-banner>
          ) : null}

          <Form method="post">
            <s-stack gap="base">
              <DslEditor value={rulesScript} onChange={setRulesScript} />

              {actionData ? (
                <s-banner
                  tone={actionData.ok ? "success" : "critical"}
                  heading={actionData.ok ? "Rules action completed" : "Rules action failed"}
                >
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{actionData.message}</pre>
                </s-banner>
              ) : null}

              <s-stack direction="inline" gap="base">
                <button
                  type="submit"
                  name="intent"
                  value="publish"
                  disabled={isSubmitting}
                  style={{
                    background: "#303030",
                    border: "1px solid #303030",
                    borderRadius: 6,
                    color: "#ffffff",
                    cursor: isSubmitting ? "default" : "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    minHeight: 36,
                    padding: "0 14px",
                  }}
                >
                  Save and publish
                </button>
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Saved compiled JSON">
        <pre
          style={{
            background: "#f6f8fa",
            border: "1px solid #d0d7de",
            borderRadius: 6,
            color: "#24292f",
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.5,
            margin: 0,
            overflowX: "auto",
            padding: 16,
            whiteSpace: "pre",
          }}
        >
          {highlightJson(previewJson)}
        </pre>
      </s-section>

      <s-section slot="aside" heading="Campaigns">
        <s-unordered-list>
          <s-list-item>
            <s-text>HideRates: hide matching delivery options.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>ShippingDiscount: apply a discount to matching delivery options.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>CartValidation: show a blocking checkout message when qualifiers match.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>condition: "all" means every qualifier must match.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>condition: "any" creates one rule per qualifier.</s-text>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Qualifiers">
        <s-unordered-list>
          <s-list-item>
            <s-text>CodeQualifier: discount code includes or does not include text.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>NoDiscountCodeQualifier: cart has no discount code.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>CartSubtotalQualifier: subtotal greater than or less than an amount.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>CartQuantityQualifier: total cart quantity checks.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>CartHasItemQualifier: currently supports product tag presence.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>CountryCodeQualifier: shipping country code checks.</s-text>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Selectors">
        <s-unordered-list>
          <s-list-item>
            <s-text>RateNameSelector: matches delivery option title and handle.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>AllRatesSelector: hides every delivery option.</s-text>
          </s-list-item>
        </s-unordered-list>
        <s-paragraph>
          Matching is case-insensitive. Current product tags wired in the function are box_shipping, subs_box_mvp, and
          bf22_exc.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
