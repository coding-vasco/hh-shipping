import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

/* global process */
/* eslint-disable react/prop-types */

const CONTROL_NAMESPACE = "$app:hh-control-room";
const CONTROL_KEY = "control-config";
const DEFAULT_CONTROL = {
  enabled: true,
  disableHideRates: false,
  disableShippingDiscounts: false,
  disableCartValidations: false,
  disableDiscountCodeRules: false,
};

function assertNoGraphqlErrors(json) {
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
}

function normalizeControl(value) {
  if (!value || typeof value !== "object") return DEFAULT_CONTROL;

  return {
    ...DEFAULT_CONTROL,
    enabled: value.enabled !== false,
    disableHideRates: value.disableHideRates === true,
    disableShippingDiscounts: value.disableShippingDiscounts === true,
    disableCartValidations: value.disableCartValidations === true,
    disableDiscountCodeRules: value.disableDiscountCodeRules === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

async function getShopWithControl(admin) {
  const response = await admin.graphql(`#graphql
    query ShopControlConfig {
      shop {
        id
        metafield(namespace: "$app:hh-control-room", key: "control-config") {
          jsonValue
        }
      }
    }
  `);
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const shop = json.data?.shop;
  if (!shop?.id) throw new Error("Could not find the shop.");

  return {
    id: shop.id,
    control: normalizeControl(shop.metafield?.jsonValue),
  };
}

async function saveControlConfig(admin, ownerId, control) {
  const response = await admin.graphql(
    `#graphql
      mutation SaveControlConfig($metafields: [MetafieldsSetInput!]!) {
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
            namespace: CONTROL_NAMESPACE,
            key: CONTROL_KEY,
            type: "json",
            value: JSON.stringify(control),
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

function appEnvironment() {
  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  if (appUrl.includes("hh-shipping-rules.onrender.com")) return "production";
  if (appUrl.includes("hh-shipping.onrender.com")) return "development";
  return process.env.NODE_ENV === "production" ? "deployed" : "local";
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { control } = await getShopWithControl(admin);

  return {
    appEnvironment: appEnvironment(),
    shop: session.shop,
    control,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const { id } = await getShopWithControl(admin);
  const control = {
    enabled: formData.get("enabled") === "on",
    disableHideRates: formData.get("disableHideRates") === "on",
    disableShippingDiscounts: formData.get("disableShippingDiscounts") === "on",
    disableCartValidations: formData.get("disableCartValidations") === "on",
    disableDiscountCodeRules: formData.get("disableDiscountCodeRules") === "on",
    updatedAt: new Date().toISOString(),
  };

  try {
    await saveControlConfig(admin, id, control);
  } catch (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Control Room settings saved." };
};

function statusLabel(control) {
  if (!control.enabled) return { text: "Paused", color: "#b42318", background: "#fff4f2", border: "#ffd6cf" };
  const pausedCount = [
    control.disableHideRates,
    control.disableShippingDiscounts,
    control.disableCartValidations,
    control.disableDiscountCodeRules,
  ].filter(Boolean).length;
  if (pausedCount > 0) return { text: "Partially paused", color: "#946200", background: "#fff8e5", border: "#f1c96b" };
  return { text: "Active", color: "#008060", background: "#effbf5", border: "#a8e3c3" };
}

function ToggleRow({ name, title, description, checked }) {
  return (
    <div
      style={{
        alignItems: "center",
        borderBottom: "1px solid #eceff3",
        display: "grid",
        gap: 16,
        gridTemplateColumns: "1fr auto",
        padding: "14px 0",
      }}
    >
      <span>
        <label htmlFor={name} style={{ color: "#202223", display: "block", fontSize: 14, fontWeight: 800 }}>
          {title}
        </label>
        <span style={{ color: "#5c6470", display: "block", fontSize: 13, marginTop: 3 }}>{description}</span>
      </span>
      <input id={name} name={name} type="checkbox" defaultChecked={checked} style={{ height: 20, width: 20 }} />
    </div>
  );
}

export default function ControlRoom() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const control = loaderData.control;
  const currentStatus = statusLabel(control);
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Control Room">
      <s-section heading="Checkout impact controls">
        <s-stack gap="base">
          <s-banner
            tone={loaderData.appEnvironment === "production" ? "critical" : "info"}
            heading={`${loaderData.appEnvironment.toUpperCase()} environment`}
          >
            <s-paragraph>
              Editing controls for <s-text type="emphasis">{loaderData.shop}</s-text>. These controls affect checkout
              without changing the campaign script.
            </s-paragraph>
          </s-banner>

          <div
            style={{
              background: currentStatus.background,
              border: `1px solid ${currentStatus.border}`,
              borderRadius: 8,
              padding: 16,
            }}
          >
            <div style={{ color: currentStatus.color, fontSize: 14, fontWeight: 900 }}>{currentStatus.text}</div>
            <div style={{ color: "#4a4f55", fontSize: 13, marginTop: 4 }}>
              Missing control config defaults to all controls active for easy testing after app updates.
            </div>
          </div>

          {actionData ? (
            <s-banner tone={actionData.ok ? "success" : "critical"} heading={actionData.ok ? "Controls saved" : "Controls failed"}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{actionData.message}</pre>
            </s-banner>
          ) : null}

          <Form method="post">
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #d8dee6",
                borderRadius: 8,
                padding: "4px 18px 18px",
              }}
            >
              <ToggleRow
                checked={control.enabled}
                description="When off, all HH Shipping Rules Functions return fail-open results."
                name="enabled"
                title="Global app impact enabled"
              />
              <ToggleRow
                checked={control.disableHideRates}
                description="When on, delivery options are never hidden by HH Shipping Rules."
                name="disableHideRates"
                title="Pause Hide Rates"
              />
              <ToggleRow
                checked={control.disableShippingDiscounts}
                description="When on, HH Shipping Rules never applies shipping discount candidates."
                name="disableShippingDiscounts"
                title="Pause Shipping Discounts"
              />
              <ToggleRow
                checked={control.disableCartValidations}
                description="When on, HH Shipping Rules never blocks checkout with validation messages."
                name="disableCartValidations"
                title="Pause Cart Validations"
              />
              <ToggleRow
                checked={control.disableDiscountCodeRules}
                description="When on, rules that depend on checkout discount-code sync are ignored."
                name="disableDiscountCodeRules"
                title="Pause Discount-Code Rules"
              />

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <button
                  disabled={isSubmitting}
                  style={{
                    background: "#303030",
                    border: "1px solid #303030",
                    borderRadius: 6,
                    color: "#ffffff",
                    cursor: isSubmitting ? "default" : "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                    minHeight: 36,
                    padding: "0 14px",
                  }}
                  type="submit"
                >
                  Save controls
                </button>
              </div>
            </div>
          </Form>

          <s-text>Last saved: {control.updatedAt ? new Date(control.updatedAt).toLocaleString() : "not saved yet"}</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
