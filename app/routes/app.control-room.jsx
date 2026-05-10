import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

/* global process */
/* eslint-disable react/prop-types */

const CONTROL_NAMESPACE = "$app:hh-control-room";
const CONTROL_KEY = "control-config";
const DELIVERY_CUSTOMIZATION_TITLE = "HH delivery customization POC";
const SHIPPING_DISCOUNT_TITLE = "HH shipping discounts POC";
const CHECKOUT_VALIDATION_TITLE = "HH checkout validation POC";
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

function configFromMetafield(node) {
  const config = node?.metafield?.jsonValue;
  return config && typeof config === "object" ? config : null;
}

function countRules(config, key) {
  const rules = config?.[key];
  return Array.isArray(rules) ? rules.length : 0;
}

function usesDiscountCodeConditions(rule) {
  const conditions = rule?.conditions ?? {};
  return Boolean(
    conditions.noDiscountCode ||
      Array.isArray(conditions.discountCodeIncludes) ||
      Array.isArray(conditions.discountCodeDoesNotInclude),
  );
}

function countDiscountCodeRules(config, key) {
  const rules = config?.[key];
  if (!Array.isArray(rules)) return 0;
  return rules.filter(usesDiscountCodeConditions).length;
}

function runtimeStatus({ checkoutValidation, deliveryCustomization, shippingDiscount }) {
  const deliveryConfig = configFromMetafield(deliveryCustomization);
  const shippingConfig = configFromMetafield(shippingDiscount);
  const validationConfig = configFromMetafield(checkoutValidation);

  return {
    hideRates: {
      configured: Boolean(deliveryConfig),
      enabled: deliveryCustomization?.enabled === true,
      count: countRules(deliveryConfig, "rules"),
      discountCodeRules: countDiscountCodeRules(deliveryConfig, "rules"),
    },
    shippingDiscounts: {
      configured: Boolean(shippingConfig),
      enabled: shippingDiscount?.status === "ACTIVE",
      count: countRules(shippingConfig, "shippingDiscounts"),
      discountCodeRules: countDiscountCodeRules(shippingConfig, "shippingDiscounts"),
      status: shippingDiscount?.status ?? "MISSING",
    },
    cartValidations: {
      configured: Boolean(validationConfig),
      enabled: checkoutValidation?.enabled === true,
      count: countRules(validationConfig, "validations"),
      discountCodeRules: countDiscountCodeRules(validationConfig, "validations"),
    },
  };
}

async function getShopWithControl(admin) {
  const response = await admin.graphql(`#graphql
    query ControlRoomStatus {
      shop {
        id
        metafield(namespace: "$app:hh-control-room", key: "control-config") {
          jsonValue
        }
      }
      deliveryCustomizations(first: 25) {
        nodes {
          id
          title
          enabled
          metafield(namespace: "$app:hh-delivery-customization", key: "function-configuration") {
            jsonValue
          }
        }
      }
      discountNodes(first: 25, query: "type:app AND method:automatic") {
        nodes {
          discount {
            __typename
            ... on DiscountAutomaticApp {
              discountId
              title
              status
              metafield(namespace: "$app:hh-shipping-discount", key: "function-configuration") {
                jsonValue
              }
            }
          }
        }
      }
      validations(first: 25) {
        nodes {
          id
          title
          enabled
          metafield(namespace: "$app:hh-checkout-validation", key: "function-configuration") {
            jsonValue
          }
        }
      }
    }
  `);
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const shop = json.data?.shop;
  if (!shop?.id) throw new Error("Could not find the shop.");

  const deliveryCustomization = (json.data?.deliveryCustomizations?.nodes ?? []).find(
    (node) => node.title === DELIVERY_CUSTOMIZATION_TITLE,
  );
  const shippingDiscount = (json.data?.discountNodes?.nodes ?? []).find(
    (node) => node.discount?.title === SHIPPING_DISCOUNT_TITLE,
  )?.discount;
  const checkoutValidation = (json.data?.validations?.nodes ?? []).find(
    (node) => node.title === CHECKOUT_VALIDATION_TITLE,
  );

  return {
    id: shop.id,
    control: normalizeControl(shop.metafield?.jsonValue),
    runtime: runtimeStatus({
      checkoutValidation,
      deliveryCustomization,
      shippingDiscount,
    }),
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
  const { control, runtime } = await getShopWithControl(admin);

  return {
    appEnvironment: appEnvironment(),
    shop: session.shop,
    control,
    runtime,
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

const CAPABILITIES = {
  hideRates: {
    accent: "#c4281c",
    background: "#fff4f2",
    border: "#ffd6cf",
    countLabel: "hide-rate rules",
    icon: "x",
    title: "Hide Rates",
  },
  shippingDiscounts: {
    accent: "#0b6bcb",
    background: "#f0f7ff",
    border: "#c6def7",
    countLabel: "shipping discounts",
    icon: "%",
    title: "Shipping Discount",
  },
  cartValidations: {
    accent: "#946200",
    background: "#fff8e5",
    border: "#f1c96b",
    countLabel: "checkout validations",
    icon: "!",
    title: "Cart Validation",
  },
  discountCodeRules: {
    accent: "#4b5563",
    background: "#f8fafc",
    border: "#d8dee6",
    countLabel: "discount-code dependent rules",
    icon: "#",
    title: "Discount-Code Sync",
  },
};

function readiness({ controlPaused, globalEnabled, runtime, setupRequired = true }) {
  if (!globalEnabled || controlPaused) {
    return {
      background: "#fff8e5",
      border: "#f1c96b",
      color: "#946200",
      icon: "!",
      text: "Paused",
    };
  }

  if (setupRequired && (!runtime.configured || !runtime.enabled)) {
    return {
      background: "#fff4f2",
      border: "#ffd6cf",
      color: "#b42318",
      icon: "!",
      text: "Needs setup",
    };
  }

  return {
    background: "#effbf5",
    border: "#a8e3c3",
    color: "#008060",
    icon: "✓",
    text: "Ready",
  };
}

function StatusPill({ status }) {
  return (
    <span
      style={{
        alignItems: "center",
        background: status.background,
        border: `1px solid ${status.border}`,
        borderRadius: 999,
        color: status.color,
        display: "inline-flex",
        fontSize: 12,
        fontWeight: 900,
        gap: 6,
        padding: "4px 9px",
      }}
    >
      <span>{status.icon}</span>
      <span>{status.text}</span>
    </span>
  );
}

function IconBadge({ capability }) {
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "center",
        background: capability.accent,
        borderRadius: 999,
        color: "#ffffff",
        display: "inline-flex",
        fontSize: 13,
        fontWeight: 900,
        height: 28,
        justifyContent: "center",
        lineHeight: "28px",
        width: 28,
      }}
    >
      {capability.icon}
    </span>
  );
}

function CapabilityCard({ checked, description, disabledCopy, name, runtime, titleKey, globalEnabled, setupRequired = true }) {
  const capability = CAPABILITIES[titleKey];
  const status = readiness({
    controlPaused: checked,
    globalEnabled,
    runtime,
    setupRequired,
  });

  return (
    <div
      style={{
        background: capability.background,
        border: `1px solid ${capability.border}`,
        borderRadius: 8,
        display: "grid",
        gap: 14,
        padding: 16,
      }}
    >
      <div style={{ alignItems: "start", display: "grid", gap: 12, gridTemplateColumns: "auto 1fr auto" }}>
        <IconBadge capability={capability} />
        <div>
          <div style={{ color: "#202223", fontSize: 15, fontWeight: 900 }}>{capability.title}</div>
          <div style={{ color: "#4a4f55", fontSize: 13, marginTop: 3 }}>{description}</div>
        </div>
        <StatusPill status={status} />
      </div>

      <div
        style={{
          background: "#ffffff",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 8,
          color: "#303030",
          display: "grid",
          fontSize: 13,
          gap: 6,
          padding: 12,
        }}
      >
        <div>
          <strong>Published:</strong> {runtime.count ?? 0} {capability.countLabel}
        </div>
        <div>
          <strong>Setup:</strong> {runtime.configured ? "config present" : "config missing"}
          {runtime.status ? `; Shopify status ${runtime.status}` : runtime.enabled ? "; Shopify enabled" : "; Shopify inactive"}
        </div>
        <div>
          <strong>Dependencies:</strong> {runtime.discountCodeRules ?? 0} discount-code dependent rules
        </div>
      </div>

      <label
        htmlFor={name}
        style={{
          alignItems: "center",
          display: "flex",
          gap: 10,
          justifyContent: "flex-end",
        }}
      >
        <span style={{ color: checked ? "#946200" : "#008060", fontSize: 13, fontWeight: 800 }}>
          {checked ? disabledCopy : "Allowed to affect checkout"}
        </span>
        <input id={name} name={name} type="checkbox" defaultChecked={checked} style={{ height: 20, width: 20 }} />
      </label>
    </div>
  );
}

function GlobalImpactCard({ control }) {
  const status = control.enabled
    ? { text: "Ready", color: "#008060", background: "#effbf5", border: "#a8e3c3", icon: "✓" }
    : { text: "Paused", color: "#b42318", background: "#fff4f2", border: "#ffd6cf", icon: "!" };

  return (
    <div
      style={{
        background: control.enabled ? "#effbf5" : "#fff4f2",
        border: `1px solid ${control.enabled ? "#a8e3c3" : "#ffd6cf"}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ alignItems: "center", display: "grid", gap: 12, gridTemplateColumns: "auto 1fr auto" }}>
        <IconBadge
          capability={{
            accent: control.enabled ? "#008060" : "#b42318",
            icon: control.enabled ? "✓" : "!",
          }}
        />
        <div>
          <div style={{ color: "#202223", fontSize: 15, fontWeight: 900 }}>Global App Impact</div>
          <div style={{ color: "#4a4f55", fontSize: 13, marginTop: 3 }}>
            Master switch for all HH Shipping Rules checkout behavior.
          </div>
        </div>
        <StatusPill status={status} />
      </div>
      <label
        htmlFor="enabled"
        style={{
          alignItems: "center",
          display: "flex",
          gap: 10,
          justifyContent: "flex-end",
          marginTop: 12,
        }}
      >
        <span style={{ color: control.enabled ? "#008060" : "#b42318", fontSize: 13, fontWeight: 800 }}>
          {control.enabled ? "Allowed to affect checkout" : "All app behavior paused"}
        </span>
        <input id="enabled" name="enabled" type="checkbox" defaultChecked={control.enabled} style={{ height: 20, width: 20 }} />
      </label>
    </div>
  );
}

export default function ControlRoom() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const control = loaderData.control;
  const runtime = loaderData.runtime;
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
            <s-stack gap="base">
              <GlobalImpactCard control={control} />

              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                <CapabilityCard
                  checked={control.disableHideRates}
                  description="Hide matching delivery options when campaign conditions match."
                  disabledCopy="Hide Rates paused"
                  globalEnabled={control.enabled}
                  name="disableHideRates"
                  runtime={runtime.hideRates}
                  titleKey="hideRates"
                />
                <CapabilityCard
                  checked={control.disableShippingDiscounts}
                  description="Apply shipping discounts to selected delivery options."
                  disabledCopy="Shipping Discounts paused"
                  globalEnabled={control.enabled}
                  name="disableShippingDiscounts"
                  runtime={runtime.shippingDiscounts}
                  titleKey="shippingDiscounts"
                />
                <CapabilityCard
                  checked={control.disableCartValidations}
                  description="Block checkout and show customer-facing validation messages."
                  disabledCopy="Cart Validations paused"
                  globalEnabled={control.enabled}
                  name="disableCartValidations"
                  runtime={runtime.cartValidations}
                  titleKey="cartValidations"
                />
                <CapabilityCard
                  checked={control.disableDiscountCodeRules}
                  description="Allow rules that depend on checkout discount-code sync."
                  disabledCopy="Discount-code rules paused"
                  globalEnabled={control.enabled}
                  name="disableDiscountCodeRules"
                  runtime={{
                    configured: true,
                    count:
                      runtime.hideRates.discountCodeRules +
                      runtime.shippingDiscounts.discountCodeRules +
                      runtime.cartValidations.discountCodeRules,
                    discountCodeRules:
                      runtime.hideRates.discountCodeRules +
                      runtime.shippingDiscounts.discountCodeRules +
                      runtime.cartValidations.discountCodeRules,
                    enabled: true,
                  }}
                  setupRequired={false}
                  titleKey="discountCodeRules"
                />
              </div>

              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #d8dee6",
                  borderRadius: 8,
                  display: "grid",
                  gap: 8,
                  padding: 14,
                }}
              >
                <div style={{ color: "#202223", fontSize: 14, fontWeight: 900 }}>Runtime observability</div>
                <div style={{ color: "#4a4f55", fontSize: 13 }}>
                  Checkout is using the published Shopify metafield configs. Control Room changes do not edit the DSL.
                </div>
                <div style={{ color: "#303030", display: "grid", fontSize: 13, gap: 5 }}>
                  <span>
                    <strong>Hide Rates:</strong> {runtime.hideRates.configured ? "config present" : "config missing"}
                  </span>
                  <span>
                    <strong>Shipping Discount:</strong> {runtime.shippingDiscounts.status}
                  </span>
                  <span>
                    <strong>Cart Validation:</strong> {runtime.cartValidations.enabled ? "active" : "inactive"}
                  </span>
                  <span>
                    <strong>Last control save:</strong>{" "}
                    {control.updatedAt ? new Date(control.updatedAt).toLocaleString() : "not saved yet"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
            </s-stack>
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
