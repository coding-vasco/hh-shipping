import { useEffect, useMemo, useState } from "react";
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

function compileForServer(source) {
  try {
    return { ok: true, ...compileRulesScript(source) };
  } catch (error) {
    return { ok: false, message: error.message, json: "" };
  }
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
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

  if (intent === "publish") {
    try {
      await publishConfig(admin, compiled.config);
      await db.shippingRulesConfig.update({
        where: { shop: session.shop },
        data: { publishedJson: compiled.json },
      });
    } catch (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Rules compiled, saved, and published to checkout." };
  }

  return { ok: true, message: "Rules compiled and saved as a draft." };
};

function highlightJson(json) {
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
  const parts = [];
  let lastIndex = 0;

  for (const match of json.matchAll(tokenPattern)) {
    if (match.index > lastIndex) parts.push(json.slice(lastIndex, match.index));

    const [token, key, string, literal, number] = match;
    const color = key ? "#0550ae" : string ? "#0a7f3f" : literal ? "#8250df" : number ? "#953800" : "inherit";
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

export default function Index() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [rulesScript, setRulesScript] = useState(loaderData.rulesScript);

  const isSubmitting = navigation.state === "submitting";
  const hasLocalChanges = rulesScript !== loaderData.rulesScript;
  const ruleCount = useMemo(() => {
    try {
      return JSON.parse(loaderData.rulesJson).rules?.length ?? 0;
    } catch {
      return 0;
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
              <s-text>Compiled rules: {ruleCount}</s-text>
              <s-text>Unsaved changes: {hasLocalChanges ? "yes" : "no"}</s-text>
              <s-text>Published: {loaderData.publishedJson ? "yes" : "not yet"}</s-text>
            </s-stack>
          </s-box>

          <Form method="post">
            <s-stack gap="base">
              <textarea
                name="rulesScript"
                value={rulesScript}
                onChange={(event) => setRulesScript(event.target.value)}
                spellCheck="false"
                style={{
                  background: "#fbfbfb",
                  border: "1px solid #c9cccf",
                  borderRadius: 6,
                  boxSizing: "border-box",
                  color: "#1f2124",
                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  fontSize: 13,
                  lineHeight: 1.5,
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
                  {...(isSubmitting ? { disabled: true } : {})}
                >
                  Save draft
                </s-button>
                <s-button
                  type="submit"
                  name="intent"
                  value="publish"
                  variant="primary"
                  {...(isSubmitting ? { disabled: true } : {})}
                >
                  Publish to checkout
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Compiled JSON">
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
