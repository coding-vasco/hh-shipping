import { useEffect, useMemo, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const CONFIG_NAMESPACE = "$app:hh-delivery-customization";
const CONFIG_KEY = "function-configuration";

const DEFAULT_RULES = {
  version: 1,
  rules: [
    {
      id: "vip-goldjoy-subscription-only",
      enabled: true,
      description: "VIP50/GOLDJOY customers only see subscription delivery options.",
      conditions: {
        discountCodeIncludes: ["VIP50", "GOLDJOY"],
      },
      actions: [
        {
          type: "hideDeliveryOptionsWhereTitleDoesNotInclude",
          values: ["subscription"],
        },
      ],
    },
    {
      id: "normal-hide-subscription",
      enabled: true,
      description: "Non-campaign carts do not see subscription delivery options.",
      conditions: {
        noDiscountCode: true,
      },
      actions: [
        {
          type: "hideDeliveryOptionsWhereTitleIncludes",
          values: ["subscription"],
        },
      ],
    },
    {
      id: "non-campaign-code-hide-subscription",
      enabled: true,
      description: "Discounted carts without VIP50/GOLDJOY do not see subscription delivery options.",
      conditions: {
        discountCodeDoesNotInclude: ["VIP50", "GOLDJOY"],
      },
      actions: [
        {
          type: "hideDeliveryOptionsWhereTitleIncludes",
          values: ["subscription"],
        },
      ],
    },
    {
      id: "hhcsf-hide-eco",
      enabled: true,
      description: "HHCSF hides eco delivery options.",
      conditions: {
        discountCodeIncludes: ["HHCSF"],
      },
      actions: [
        {
          type: "hideDeliveryOptionsWhereTitleIncludes",
          values: ["eco"],
        },
      ],
    },
  ],
};

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function normalizeStringArray(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${path} must be an array of strings.`);
  }
}

function normalizeNumber(value, path, errors) {
  if (value === undefined) return;
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${path} must be a number.`);
  }
}

function validateRulesConfig(config) {
  const errors = [];
  const allowedActions = new Set([
    "hideDeliveryOptionsWhereTitleIncludes",
    "hideDeliveryOptionsWhereTitleDoesNotInclude",
    "hideAllDeliveryOptions",
  ]);

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["Config must be a JSON object."];
  }

  if (config.version !== 1) {
    errors.push("version must be 1.");
  }

  if (!Array.isArray(config.rules)) {
    errors.push("rules must be an array.");
    return errors;
  }

  config.rules.forEach((rule, index) => {
    const prefix = `rules[${index}]`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    if (!rule.id || typeof rule.id !== "string") {
      errors.push(`${prefix}.id is required and must be a string.`);
    }

    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") {
      errors.push(`${prefix}.enabled must be a boolean when provided.`);
    }

    if (!rule.conditions || typeof rule.conditions !== "object" || Array.isArray(rule.conditions)) {
      errors.push(`${prefix}.conditions must be an object.`);
    } else {
      normalizeStringArray(rule.conditions.discountCodeIncludes, `${prefix}.conditions.discountCodeIncludes`, errors);
      normalizeStringArray(
        rule.conditions.discountCodeDoesNotInclude,
        `${prefix}.conditions.discountCodeDoesNotInclude`,
        errors,
      );
      normalizeStringArray(rule.conditions.deliveryTitleIncludes, `${prefix}.conditions.deliveryTitleIncludes`, errors);
      normalizeStringArray(
        rule.conditions.deliveryTitleDoesNotInclude,
        `${prefix}.conditions.deliveryTitleDoesNotInclude`,
        errors,
      );
      normalizeStringArray(rule.conditions.lineProductTagIncludes, `${prefix}.conditions.lineProductTagIncludes`, errors);
      normalizeStringArray(
        rule.conditions.lineProductTagDoesNotInclude,
        `${prefix}.conditions.lineProductTagDoesNotInclude`,
        errors,
      );
      normalizeStringArray(rule.conditions.countryCodeIs, `${prefix}.conditions.countryCodeIs`, errors);
      normalizeNumber(rule.conditions.cartTotalQuantityGreaterThan, `${prefix}.conditions.cartTotalQuantityGreaterThan`, errors);
      normalizeNumber(
        rule.conditions.cartTotalQuantityLessThanOrEqual,
        `${prefix}.conditions.cartTotalQuantityLessThanOrEqual`,
        errors,
      );
      normalizeNumber(rule.conditions.subtotalGreaterThan, `${prefix}.conditions.subtotalGreaterThan`, errors);
      normalizeNumber(rule.conditions.subtotalLessThan, `${prefix}.conditions.subtotalLessThan`, errors);

      if (rule.conditions.noDiscountCode !== undefined && typeof rule.conditions.noDiscountCode !== "boolean") {
        errors.push(`${prefix}.conditions.noDiscountCode must be a boolean when provided.`);
      }
    }

    if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
      errors.push(`${prefix}.actions must be a non-empty array.`);
    } else {
      rule.actions.forEach((action, actionIndex) => {
        const actionPrefix = `${prefix}.actions[${actionIndex}]`;
        if (!action || typeof action !== "object" || Array.isArray(action)) {
          errors.push(`${actionPrefix} must be an object.`);
          return;
        }

        if (!allowedActions.has(action.type)) {
          errors.push(`${actionPrefix}.type is not supported.`);
        }

        if (action.type !== "hideAllDeliveryOptions") {
          normalizeStringArray(action.values, `${actionPrefix}.values`, errors);
          if (Array.isArray(action.values) && action.values.length === 0) {
            errors.push(`${actionPrefix}.values must not be empty.`);
          }
        }
      });
    }
  });

  return errors;
}

async function getDeliveryCustomizationId(admin) {
  const response = await admin.graphql(`#graphql
    query DeliveryCustomizationsForConfig {
      deliveryCustomizations(first: 25) {
        nodes {
          id
          title
          enabled
        }
      }
    }
  `);
  const json = await response.json();
  const nodes = json.data?.deliveryCustomizations?.nodes ?? [];
  const preferred =
    nodes.find((node) => node.title === "HH delivery customization POC") ??
    nodes.find((node) => node.enabled) ??
    nodes[0];

  if (!preferred) {
    throw new Error("No delivery customization exists. Activate the delivery customization before publishing rules.");
  }

  return preferred.id;
}

async function publishConfig(admin, config) {
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
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const config = await db.shippingRulesConfig.upsert({
    where: { shop: session.shop },
    update: {},
    create: {
      shop: session.shop,
      rulesJson: prettyJson(DEFAULT_RULES),
    },
  });

  return {
    shop: session.shop,
    rulesJson: config.rulesJson,
    publishedJson: config.publishedJson,
    updatedAt: config.updatedAt,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const rulesJson = String(formData.get("rulesJson") ?? "");

  let parsed;
  try {
    parsed = JSON.parse(rulesJson);
  } catch (error) {
    return { ok: false, message: `Invalid JSON: ${error.message}` };
  }

  const validationErrors = validateRulesConfig(parsed);
  if (validationErrors.length > 0) {
    return { ok: false, message: validationErrors.join("\n") };
  }

  await db.shippingRulesConfig.upsert({
    where: { shop: session.shop },
    update: { rulesJson: prettyJson(parsed) },
    create: {
      shop: session.shop,
      rulesJson: prettyJson(parsed),
    },
  });

  if (intent === "publish") {
    try {
      await publishConfig(admin, parsed);
      await db.shippingRulesConfig.update({
        where: { shop: session.shop },
        data: { publishedJson: prettyJson(parsed) },
      });
    } catch (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Rules saved and published to the delivery customization." };
  }

  return { ok: true, message: "Rules saved." };
};

export default function Index() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [rulesJson, setRulesJson] = useState(loaderData.rulesJson);

  const isSubmitting = navigation.state === "submitting";
  const hasLocalChanges = rulesJson !== loaderData.rulesJson;
  const parsedRuleCount = useMemo(() => {
    try {
      return JSON.parse(rulesJson).rules?.length ?? 0;
    } catch {
      return 0;
    }
  }, [rulesJson]);

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message, {
        isError: !actionData.ok,
      });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Shipping Rules">
      <s-section heading="Store rules">
        <s-stack gap="base">
          <s-paragraph>
            Editing rules for <s-text type="emphasis">{loaderData.shop}</s-text>. Conditions inside a rule are
            combined with AND. Rules are evaluated in order, and matching hide actions are accumulated.
          </s-paragraph>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-text>Rules: {parsedRuleCount}</s-text>
              <s-text>Unsaved changes: {hasLocalChanges ? "yes" : "no"}</s-text>
              <s-text>Published: {loaderData.publishedJson ? "yes" : "not yet"}</s-text>
            </s-stack>
          </s-box>

          <Form method="post">
            <s-stack gap="base">
              <textarea
                name="rulesJson"
                value={rulesJson}
                onChange={(event) => setRulesJson(event.target.value)}
                spellCheck="false"
                style={{
                  boxSizing: "border-box",
                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  fontSize: 13,
                  minHeight: 520,
                  padding: 16,
                  width: "100%",
                }}
              />

              {actionData && !actionData.ok ? (
                <s-banner tone="critical" heading="Rules could not be saved">
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{actionData.message}</pre>
                </s-banner>
              ) : null}

              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  name="intent"
                  value="save"
                  {...(isSubmitting ? { loading: true } : {})}
                >
                  Save draft
                </s-button>
                <s-button
                  type="submit"
                  name="intent"
                  value="publish"
                  variant="primary"
                  {...(isSubmitting ? { loading: true } : {})}
                >
                  Publish to checkout
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Phase 1 conditions">
        <s-unordered-list>
          <s-list-item>
            <s-text>discountCodeIncludes: string[]</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>discountCodeDoesNotInclude: string[]</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>noDiscountCode: boolean</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>deliveryTitleIncludes / deliveryTitleDoesNotInclude: string[]</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>cartTotalQuantityGreaterThan / cartTotalQuantityLessThanOrEqual: number</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>lineProductTagIncludes / lineProductTagDoesNotInclude: string[]</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>subtotalGreaterThan / subtotalLessThan: number</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>countryCodeIs: string[]</s-text>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Phase 1 actions">
        <s-unordered-list>
          <s-list-item>
            <s-text>hideDeliveryOptionsWhereTitleIncludes</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>hideDeliveryOptionsWhereTitleDoesNotInclude</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>hideAllDeliveryOptions</s-text>
          </s-list-item>
        </s-unordered-list>
        <s-paragraph>
          Matching is case-insensitive and checks both delivery option title and handle. Current tag support is wired
          for box_shipping, subs_box_mvp, and bf22_exc.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
