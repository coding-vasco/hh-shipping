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

/* global process */

const CONFIG_NAMESPACE = "$app:hh-delivery-customization";
const CONFIG_KEY = "function-configuration";
const DELIVERY_CUSTOMIZATION_TITLE = "HH delivery customization POC";
const SHIPPING_DISCOUNT_NAMESPACE = "$app:hh-shipping-discount";
const SHIPPING_DISCOUNT_TITLE = "HH shipping discounts POC";
const CHECKOUT_VALIDATION_NAMESPACE = "$app:hh-checkout-validation";
const CHECKOUT_VALIDATION_TITLE = "HH checkout validation POC";
const CHECKOUT_UI_NAMESPACE = "$app:hh-checkout-ui";
const ADMIN_NAMESPACE = "$app:hh-shipping-admin";
const DRAFTS_KEY = "dsl-drafts";
const FUNCTION_INPUT_NAMESPACE = "$app:hh-function-input";
const FUNCTION_INPUT_KEY = "input-variables";
const MAX_DSL_DRAFTS = 10;
const ALWAYS_ACTIVE_DISCOUNT_STARTS_AT = "2020-01-01T00:00:00Z";
const EMPTY_RULES_JSON = JSON.stringify(
  {
    version: 1,
    productTags: ["box_shipping", "subs_box_mvp", "bf22_exc"],
    rules: [],
    shippingDiscounts: [],
    validations: [],
  },
  null,
  2,
);
const DSL_EXAMPLES = [
  {
    title: "Code hides rates",
    code: `HideRates({
  name: "HHCSF hides eco",
  condition: "all",
  qualifiers: [
    CodeQualifier({ match: "include", codes: ["HHCSF"] }),
  ],
  rateSelector: RateNameSelector({ match: "include", names: ["eco"] }),
})`,
  },
  {
    title: "Tag gives free shipping",
    code: `ShippingDiscount({
  name: "VIP tag free standard",
  condition: "all",
  qualifiers: [
    CartHasItemQualifier({
      comparison: "greater_than_or_equal",
      amount: 1,
      selector: ProductTagSelector({ match: "match", tags: ["vip_tag"] }),
    }),
  ],
  rateSelector: RateNameSelector({ match: "include", names: ["standard"] }),
  discount: PercentageDiscount({ percent: 100, message: "Free Shipping" }),
})`,
  },
  {
    title: "Code blocks checkout",
    code: `CartValidation({
  name: "NOMORERUST requires paid jewelry",
  condition: "all",
  qualifiers: [
    CodeQualifier({ match: "include", codes: ["NOMORERUST"] }),
    CartSubtotalQualifier({ comparison: "equal_to", amount: 0 }),
  ],
  message_title: "Discount code requires a paid item",
  message: "NOMORERUST must be used with at least one paid jewelry item.",
  target: "$.cart",
})`,
  },
];

function assertNoGraphqlErrors(json) {
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
}

function createDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDrafts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((draft) => draft && typeof draft === "object" && typeof draft.dsl === "string")
    .map((draft) => ({
      id: typeof draft.id === "string" && draft.id ? draft.id : createDraftId(),
      name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : "Untitled draft",
      dsl: draft.dsl,
      createdAt: typeof draft.createdAt === "string" ? draft.createdAt : new Date().toISOString(),
      updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : new Date().toISOString(),
    }))
    .slice(0, MAX_DSL_DRAFTS);
}

async function getDeliveryCustomizationId(admin) {
  const preferred = await getDeliveryCustomizationStatus(admin);

  return preferred?.id ?? createDeliveryCustomization(admin);
}

async function getShopId(admin) {
  const response = await admin.graphql(`#graphql
    query ShopId {
      shop {
        id
      }
    }
  `);
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const ownerId = json.data?.shop?.id;
  if (!ownerId) {
    throw new Error("Could not find the shop.");
  }

  return ownerId;
}

async function getDslDrafts(admin) {
  const response = await admin.graphql(`#graphql
    query DslDrafts {
      shop {
        metafield(namespace: "$app:hh-shipping-admin", key: "dsl-drafts") {
          value
        }
      }
    }
  `);
  const json = await response.json();
  assertNoGraphqlErrors(json);

  const value = json.data?.shop?.metafield?.value;
  if (!value) return [];

  try {
    return normalizeDrafts(JSON.parse(value));
  } catch {
    return [];
  }
}

async function saveDslDrafts(admin, drafts) {
  const ownerId = await getShopId(admin);
  const normalizedDrafts = normalizeDrafts(drafts);
  const response = await admin.graphql(
    `#graphql
      mutation SaveDslDrafts($metafields: [MetafieldsSetInput!]!) {
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
            namespace: ADMIN_NAMESPACE,
            key: DRAFTS_KEY,
            type: "json",
            value: JSON.stringify(normalizedDrafts),
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

  return normalizedDrafts;
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

async function createDeliveryCustomization(admin) {
  const response = await admin.graphql(
    `#graphql
      mutation CreateDeliveryCustomization($deliveryCustomization: DeliveryCustomizationInput!) {
        deliveryCustomizationCreate(deliveryCustomization: $deliveryCustomization) {
          deliveryCustomization {
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
        deliveryCustomization: {
          title: DELIVERY_CUSTOMIZATION_TITLE,
          enabled: true,
          functionHandle: "hh-delivery-customization",
        },
      },
    },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);
  const payload = json.data?.deliveryCustomizationCreate;
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  const id = payload?.deliveryCustomization?.id;
  if (!id) {
    throw new Error(`Could not create delivery customization "${DELIVERY_CUSTOMIZATION_TITLE}".`);
  }

  return id;
}

async function publishDeliveryConfig(admin, config) {
  const ownerId = await getDeliveryCustomizationId(admin);
  const productTags = config.productTags ?? [];
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
          {
            ownerId,
            namespace: FUNCTION_INPUT_NAMESPACE,
            key: FUNCTION_INPUT_KEY,
            type: "json",
            value: JSON.stringify({ productTags }),
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
  const productTags = config.productTags ?? [];
  return {
    title: SHIPPING_DISCOUNT_TITLE,
    functionHandle: "hh-shipping-discount",
    discountClasses: ["SHIPPING"],
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
      {
        namespace: FUNCTION_INPUT_NAMESPACE,
        key: FUNCTION_INPUT_KEY,
        type: "json",
        value: JSON.stringify({ productTags }),
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
  const existing = await getShippingDiscountStatus(admin);
  const existingId = existing?.discountId ?? null;
  const automaticAppDiscount = shippingDiscountInput(config);
  const mutationInput = existingId
    ? automaticAppDiscount
    : {
        ...automaticAppDiscount,
        startsAt: ALWAYS_ACTIVE_DISCOUNT_STARTS_AT,
      };
  const mutation = existingId
    ? `#graphql
      mutation UpdateShippingDiscount($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount {
            discountId
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
            discountId
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
    variables: existingId ? { id: existingId, automaticAppDiscount: mutationInput } : { automaticAppDiscount: mutationInput },
  });
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const payload = existingId ? json.data?.discountAutomaticAppUpdate : json.data?.discountAutomaticAppCreate;
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  const discount = payload?.automaticAppDiscount;
  const discountId = existingId ?? discount?.discountId;
  const status = discount?.status ?? existing?.status;
  if (discountId && status !== "ACTIVE") {
    await activateShippingDiscount(admin, discountId);
  }
}

async function activateShippingDiscount(admin, id) {
  const response = await admin.graphql(
    `#graphql
      mutation ActivateShippingDiscount($id: ID!) {
        discountAutomaticActivate(id: $id) {
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
      variables: { id },
    },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  const errors = json.data?.discountAutomaticActivate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}

function checkoutValidationInput(config) {
  const productTags = config.productTags ?? [];
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
      {
        namespace: FUNCTION_INPUT_NAMESPACE,
        key: FUNCTION_INPUT_KEY,
        type: "json",
        value: JSON.stringify({ productTags }),
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
  const ownerId = await getShopId(admin);

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

function appEnvironment() {
  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  if (appUrl.includes("hh-shipping-rules.onrender.com")) return "production";
  if (appUrl.includes("hh-shipping.onrender.com")) return "development";
  return process.env.NODE_ENV === "production" ? "deployed" : "local";
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
    appEnvironment: appEnvironment(),
    shop: session.shop,
    rulesScript,
    rulesJson,
    publishedJson: config.publishedJson,
    dslDrafts: await getDslDrafts(admin),
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

  if (intent === "saveDraft") {
    const draftId = String(formData.get("draftId") ?? "");
    const draftNameInput = String(formData.get("draftName") ?? "").trim();
    const now = new Date().toISOString();
    const draftName = draftNameInput || `Draft ${new Date().toLocaleString("en-GB")}`;

    try {
      const drafts = await getDslDrafts(admin);
      const existingIndex = drafts.findIndex((draft) => draft.id === draftId);
      let nextDrafts;

      if (existingIndex >= 0) {
        nextDrafts = drafts.map((draft, index) =>
          index === existingIndex
            ? {
                ...draft,
                name: draftName,
                dsl: rulesScript,
                updatedAt: now,
              }
            : draft,
        );
      } else {
        if (drafts.length >= MAX_DSL_DRAFTS) {
          return { ok: false, message: `You can store up to ${MAX_DSL_DRAFTS} DSL drafts. Delete one before saving another.` };
        }
        nextDrafts = [
          {
            id: createDraftId(),
            name: draftName,
            dsl: rulesScript,
            createdAt: now,
            updatedAt: now,
          },
          ...drafts,
        ];
      }

      await saveDslDrafts(admin, nextDrafts);
    } catch (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "DSL draft saved. Checkout was not changed." };
  }

  if (intent === "deleteDraft") {
    const draftId = String(formData.get("draftId") ?? "");
    if (!draftId) return { ok: false, message: "Choose a draft to delete." };

    try {
      const drafts = await getDslDrafts(admin);
      await saveDslDrafts(
        admin,
        drafts.filter((draft) => draft.id !== draftId),
      );
    } catch (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "DSL draft deleted. Checkout was not changed." };
  }

  if (intent === "unpublish") {
    try {
      await publishDeliveryConfig(admin, DEFAULT_RULES);
      await publishShippingDiscountConfig(admin, DEFAULT_RULES);
      await publishCheckoutValidationConfig(admin, DEFAULT_RULES);
      await publishCheckoutUiConfig(admin, DEFAULT_RULES);
      await db.shippingRulesConfig.update({
        where: { shop: session.shop },
        data: { publishedJson: prettyJson(DEFAULT_RULES) },
      });
    } catch (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Checkout rules unpublished. The saved DSL was kept for review or later publishing." };
  }

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

  if (intent === "preview") {
    return { ok: true, message: "Rules compiled. Review the summary, then publish when ready." };
  }

  if (intent !== "publish") {
    return { ok: false, message: "Review changes first, then publish reviewed rules to checkout." };
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

// The app template does not use runtime PropTypes; React Router owns the data path.
// eslint-disable-next-line react/prop-types
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

function joinValues(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "none";
}

function describeComparison(comparison) {
  switch (comparison) {
    case "greater_than":
      return "greater than";
    case "greater_than_or_equal":
      return "at least";
    case "less_than":
      return "less than";
    case "less_than_or_equal":
      return "at most";
    case "equal_to":
      return "equal to";
    default:
      return comparison ?? "unknown";
  }
}

function conditionSummary(conditions = {}) {
  const parts = [];

  if (conditions.noDiscountCode) parts.push("cart has no discount code");
  if (conditions.discountCodeIncludes) parts.push(`discount code includes ${joinValues(conditions.discountCodeIncludes)}`);
  if (conditions.discountCodeDoesNotInclude) {
    parts.push(`discount code does not include ${joinValues(conditions.discountCodeDoesNotInclude)}`);
  }
  if (conditions.countryCodeIs) parts.push(`shipping country is ${joinValues(conditions.countryCodeIs)}`);
  if (conditions.cartTotalQuantity) {
    parts.push(`cart quantity is ${describeComparison(conditions.cartTotalQuantity.comparison)} ${conditions.cartTotalQuantity.amount}`);
  }
  if (conditions.subtotal) {
    parts.push(`subtotal is ${describeComparison(conditions.subtotal.comparison)} ${conditions.subtotal.amount}`);
  }
  if (conditions.lineProductTagQuantity) {
    const tagCondition = conditions.lineProductTagQuantity;
    const matchText = tagCondition.match === "does_not_match" ? "without tag" : "with tag";
    parts.push(
      `line quantity ${matchText} ${joinValues(tagCondition.tags)} is ${describeComparison(tagCondition.comparison)} ${tagCondition.amount}`,
    );
  }

  return parts.length > 0 ? parts.join("; ") : "always";
}

function conditionDependencies(conditions = {}) {
  const dependencies = [];

  if (conditions.discountCodeIncludes || conditions.discountCodeDoesNotInclude || conditions.noDiscountCode) {
    dependencies.push("Checkout UI discount-code sync");
  }
  if (conditions.lineProductTagQuantity?.tags?.length > 0) {
    dependencies.push(`Product tags: ${joinValues(conditions.lineProductTagQuantity.tags)}`);
  }
  if (conditions.countryCodeIs) {
    dependencies.push("Shipping address country");
  }

  return dependencies;
}

function conditionSearchTerms(conditions = {}) {
  return [
    ...(conditions.discountCodeIncludes ?? []),
    ...(conditions.discountCodeDoesNotInclude ?? []),
    ...(conditions.countryCodeIs ?? []),
    ...(conditions.lineProductTagQuantity?.tags ?? []),
  ];
}

function rateActionSummary(action) {
  if (!action) return "does nothing";
  if (action.type === "hideAllDeliveryOptions") return "hides all rates";
  if (action.type === "hideDeliveryOptionsWhereTitleIncludes") {
    return `hides rates containing ${joinValues(action.values)}`;
  }
  if (action.type === "hideDeliveryOptionsWhereTitleDoesNotInclude") {
    return `hides rates not containing ${joinValues(action.values)}`;
  }
  return `uses unsupported action ${action.type}`;
}

function rateSelectorSummary(selector) {
  if (!selector) return "no rates";
  if (selector.type === "allDeliveryOptions") return "all rates";
  if (selector.type === "deliveryOptionsWhereTitleIncludes") return `rates containing ${joinValues(selector.values)}`;
  if (selector.type === "deliveryOptionsWhereTitleDoesNotInclude") {
    return `rates not containing ${joinValues(selector.values)}`;
  }
  return `unsupported selector ${selector.type}`;
}

function discountSummary(discount) {
  if (!discount) return "no discount";
  if (discount.type === "percentage") return `${discount.value}% off`;
  if (discount.type === "fixedAmount") return `${discount.amount} off`;
  return `${discount.type} discount`;
}

function campaignVisual(type) {
  switch (type) {
    case "HideRates":
      return {
        accent: "#b42318",
        background: "#fff4f2",
        border: "#ffd6cf",
        icon: "x",
        label: "Hide Rates",
      };
    case "ShippingDiscount":
      return {
        accent: "#0b6bcb",
        background: "#f0f7ff",
        border: "#c6def7",
        icon: "%",
        label: "Shipping Discount",
      };
    case "CartValidation":
      return {
        accent: "#8a6116",
        background: "#fff8e8",
        border: "#f1d79d",
        icon: "!",
        label: "Cart Validation",
      };
    default:
      return {
        accent: "#5c5f62",
        background: "#f6f6f7",
        border: "#d2d5d8",
        icon: "i",
        label: type,
      };
  }
}

function groupCampaignsByType(campaigns) {
  const groups = [
    { type: "HideRates", description: "Hide delivery options when campaign conditions match.", campaigns: [] },
    { type: "ShippingDiscount", description: "Apply shipping discounts to selected delivery options.", campaigns: [] },
    { type: "CartValidation", description: "Block checkout and show a customer-facing message.", campaigns: [] },
  ];
  const byType = new Map(groups.map((group) => [group.type, group]));

  for (const campaign of campaigns) {
    const group = byType.get(campaign.type);
    if (group) group.campaigns.push(campaign);
  }

  return groups;
}

function campaignStatusElement(campaign) {
  const isWarning = campaign.risk.length > 0;
  return (
    <span
      style={{
        color: isWarning ? "#b7791f" : "#008060",
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {isWarning ? "⚠️ Warning" : "✓ Ready"}
    </span>
  );
}

function compiledCampaignSummaries(config) {
  const rows = [];
  const seen = new Set();

  for (const rule of config.rules ?? []) {
    const key = `hide:${rule.description}:${JSON.stringify(rule.conditions)}:${JSON.stringify(rule.actions)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: "HideRates",
      outcome: "Hide matching delivery options",
      name: rule.description || rule.id,
      when: conditionSummary(rule.conditions),
      affects: (rule.actions ?? []).map(rateActionSummary).join("; "),
      customerMessage: "None",
      dependencies: conditionDependencies(rule.conditions),
      risk: (rule.actions ?? []).some((action) => action.type === "hideAllDeliveryOptions")
        ? ["Can hide every shipping rate"]
        : [],
      searchTerms: conditionSearchTerms(rule.conditions),
    });
  }

  for (const rule of config.shippingDiscounts ?? []) {
    const key = `discount:${rule.description}:${JSON.stringify(rule.conditions)}:${JSON.stringify(rule.rateSelector)}:${JSON.stringify(rule.discount)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: "ShippingDiscount",
      outcome: `${discountSummary(rule.discount)} shipping`,
      name: rule.description || rule.id,
      when: conditionSummary(rule.conditions),
      affects: rateSelectorSummary(rule.rateSelector),
      customerMessage: rule.discount?.message || "None",
      dependencies: [
        ...conditionDependencies(rule.conditions),
        "Automatic app shipping discount",
        "Shopify discount combination settings",
      ],
      risk: [],
      searchTerms: [
        ...conditionSearchTerms(rule.conditions),
        ...(rule.rateSelector?.values ?? []),
        rule.discount?.message ?? "",
      ],
    });
  }

  for (const rule of config.validations ?? []) {
    const key = `validation:${rule.description}:${JSON.stringify(rule.conditions)}:${rule.message}:${rule.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: "CartValidation",
      outcome: "Block checkout",
      name: rule.description || rule.id,
      when: conditionSummary(rule.conditions),
      affects: rule.target ?? "$.cart",
      customerMessage: rule.messageTitle ? `${rule.messageTitle}: ${rule.message}` : rule.message,
      dependencies: conditionDependencies(rule.conditions),
      risk: ["Can block checkout"],
      searchTerms: conditionSearchTerms(rule.conditions),
    });
  }

  return rows;
}

function campaignSearchText(campaign) {
  return [
    campaign.type,
    campaign.name,
    campaign.outcome,
    campaign.when,
    campaign.affects,
    campaign.customerMessage,
    ...(campaign.dependencies ?? []),
    ...(campaign.risk ?? []),
    ...(campaign.searchTerms ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function campaignTypeCounts(campaigns) {
  return campaigns.reduce(
    (counts, campaign) => {
      counts[campaign.type] = (counts[campaign.type] ?? 0) + 1;
      return counts;
    },
    { HideRates: 0, ShippingDiscount: 0, CartValidation: 0 },
  );
}

function publishState({ hasLocalChanges, publishedJson, rulesJson }) {
  if (publishedJson === rulesJson && publishedJson !== EMPTY_RULES_JSON) {
    return {
      label: "Published",
      detail: "Checkout is using the reviewed DSL campaigns.",
      color: "#008060",
      background: "#effbf5",
      border: "#a8e3c3",
    };
  }

  if (hasLocalChanges || publishedJson === EMPTY_RULES_JSON || (!publishedJson && rulesJson === EMPTY_RULES_JSON)) {
    return {
      label: "Unpublished",
      detail: hasLocalChanges
        ? "The editor has changes that have not been reviewed yet."
        : "Checkout is using no app-managed campaigns.",
      color: "#b42318",
      background: "#fff4f2",
      border: "#ffd6cf",
    };
  }

  return {
    label: "Reviewed",
    detail: "The DSL has been reviewed, but checkout is not using this exact version yet.",
    color: "#0b6bcb",
    background: "#f0f7ff",
    border: "#c6def7",
  };
}

export default function Index() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [rulesScript, setRulesScript] = useState(loaderData.rulesScript);
  const [campaignSearch, setCampaignSearch] = useState("");
  const dslDrafts = useMemo(() => loaderData.dslDrafts ?? [], [loaderData.dslDrafts]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [draftName, setDraftName] = useState("");

  const isSubmitting = navigation.state === "submitting";
  const hasLocalChanges = rulesScript !== loaderData.rulesScript;
  const compiledConfig = useMemo(() => {
    try {
      return JSON.parse(loaderData.rulesJson);
    } catch {
      return { version: 1, rules: [], shippingDiscounts: [], validations: [] };
    }
  }, [loaderData.rulesJson]);
  const campaignSummaries = useMemo(() => compiledCampaignSummaries(compiledConfig), [compiledConfig]);
  const campaignTypeTotals = useMemo(() => campaignTypeCounts(campaignSummaries), [campaignSummaries]);
  const visibleCampaignSummaries = useMemo(() => {
    const needle = campaignSearch.trim().toLowerCase();
    if (!needle) return campaignSummaries;
    return campaignSummaries.filter((campaign) => campaignSearchText(campaign).includes(needle));
  }, [campaignSearch, campaignSummaries]);
  const visibleCampaignGroups = useMemo(() => groupCampaignsByType(visibleCampaignSummaries), [visibleCampaignSummaries]);
  const previewJson = loaderData.rulesJson;
  const currentPublishState = publishState({
    hasLocalChanges,
    publishedJson: loaderData.publishedJson,
    rulesJson: loaderData.rulesJson,
  });

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message, {
        isError: !actionData.ok,
      });
    }
  }, [actionData, shopify]);

  useEffect(() => {
    const selectedDraft = dslDrafts.find((draft) => draft.id === selectedDraftId);
    if (selectedDraft) {
      setDraftName(selectedDraft.name);
    } else if (selectedDraftId) {
      setSelectedDraftId("");
      setDraftName("");
    }
  }, [dslDrafts, selectedDraftId]);

  const selectedDraft = dslDrafts.find((draft) => draft.id === selectedDraftId);

  return (
    <s-page heading="Shipping Rules">
      <s-section heading="Environment">
        <s-banner
          tone={loaderData.appEnvironment === "production" ? "critical" : "info"}
          heading={`${loaderData.appEnvironment.toUpperCase()} environment`}
        >
          <s-paragraph>
            Editing <s-text type="emphasis">{loaderData.shop}</s-text>. Published rules affect this shop checkout.
          </s-paragraph>
        </s-banner>
      </s-section>

      <s-section heading="Campaign script">
        <s-stack gap="base">
          <s-paragraph>
            Editing rules for <s-text type="emphasis">{loaderData.shop}</s-text>. This script is intentionally small:
            campaigns define checkout outcomes, qualifiers decide when they apply, and selectors decide which rates or
            cart states are affected.
          </s-paragraph>

          <div
            style={{
              background: currentPublishState.background,
              border: `1px solid ${currentPublishState.border}`,
              borderRadius: 8,
              padding: 16,
            }}
          >
            <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
              <span
                aria-hidden="true"
                style={{
                  background: currentPublishState.color,
                  borderRadius: 99,
                  color: "#ffffff",
                  display: "inline-flex",
                  fontSize: 12,
                  fontWeight: 700,
                  height: 26,
                  justifyContent: "center",
                  lineHeight: "26px",
                  width: 26,
                }}
              >
                {currentPublishState.label === "Published" ? "✓" : currentPublishState.label === "Reviewed" ? "i" : "!"}
              </span>
              <div>
                <div style={{ color: currentPublishState.color, fontSize: 14, fontWeight: 800 }}>
                  {currentPublishState.label}
                </div>
                <div style={{ color: "#4a4f55", fontSize: 13 }}>{currentPublishState.detail}</div>
              </div>
            </div>
          </div>

          {campaignTypeTotals.ShippingDiscount > 0 && !loaderData.shippingDiscountStatus ? (
            <s-banner tone="warning" heading="Shipping discount is not active">
              <s-paragraph>
                Publish to checkout to create the automatic app discount that invokes the HH Shipping Discount
                function.
              </s-paragraph>
            </s-banner>
          ) : null}

          {campaignTypeTotals.CartValidation > 0 && !loaderData.checkoutValidationStatus?.enabled ? (
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
              <input type="hidden" name="draftId" value={selectedDraftId} />
              <input type="hidden" name="draftName" value={draftName} />

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #d8dee6",
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(180px, 1fr) minmax(180px, 1fr) auto auto auto" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ color: "#303030", fontSize: 12, fontWeight: 700 }}>Stored drafts</span>
                    <select
                      value={selectedDraftId}
                      onChange={(event) => setSelectedDraftId(event.currentTarget.value)}
                      style={{
                        border: "1px solid #b9c0ca",
                        borderRadius: 6,
                        minHeight: 36,
                        padding: "0 10px",
                      }}
                    >
                      <option value="">New draft</option>
                      {dslDrafts.map((draft) => (
                        <option key={draft.id} value={draft.id}>
                          {draft.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ color: "#303030", fontSize: 12, fontWeight: 700 }}>Draft name</span>
                    <input
                      type="text"
                      value={draftName}
                      onChange={(event) => setDraftName(event.currentTarget.value)}
                      placeholder="Name this draft"
                      style={{
                        border: "1px solid #b9c0ca",
                        borderRadius: 6,
                        minHeight: 36,
                        padding: "0 10px",
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={!selectedDraft}
                    onClick={() => selectedDraft && setRulesScript(selectedDraft.dsl)}
                    style={{
                      alignSelf: "end",
                      background: selectedDraft ? "#ffffff" : "#f1f1f1",
                      border: "1px solid #303030",
                      borderRadius: 6,
                      color: selectedDraft ? "#303030" : "#6d7175",
                      cursor: selectedDraft ? "pointer" : "default",
                      fontSize: 14,
                      fontWeight: 600,
                      minHeight: 36,
                      padding: "0 14px",
                    }}
                  >
                    Load
                  </button>

                  <button
                    type="submit"
                    name="intent"
                    value="saveDraft"
                    disabled={isSubmitting}
                    style={{
                      alignSelf: "end",
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
                    Save draft
                  </button>

                  <button
                    type="submit"
                    name="intent"
                    value="deleteDraft"
                    disabled={isSubmitting || !selectedDraft}
                    style={{
                      alignSelf: "end",
                      background: "#ffffff",
                      border: "1px solid #b42318",
                      borderRadius: 6,
                      color: selectedDraft ? "#b42318" : "#6d7175",
                      cursor: isSubmitting || !selectedDraft ? "default" : "pointer",
                      fontSize: 14,
                      fontWeight: 600,
                      minHeight: 36,
                      padding: "0 14px",
                    }}
                  >
                    Delete
                  </button>
                </div>
                <div style={{ color: "#5c6470", fontSize: 12, marginTop: 8 }}>
                  Drafts are stored in Shopify for this shop. Loading or saving a draft does not publish checkout rules.
                  {` ${dslDrafts.length}/${MAX_DSL_DRAFTS} saved.`}
                </div>
              </div>

              <DslEditor value={rulesScript} onChange={setRulesScript} />

              {actionData ? (
                <s-banner
                  tone={actionData.ok ? "success" : "critical"}
                  heading={actionData.ok ? "Rules action completed" : "Rules action failed"}
                >
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{actionData.message}</pre>
                </s-banner>
              ) : null}

              <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
                <button
                  type="submit"
                  name="intent"
                  value="preview"
                  disabled={isSubmitting}
                  style={{
                    background: hasLocalChanges ? "#303030" : "#ffffff",
                    border: "1px solid #303030",
                    borderRadius: 6,
                    color: hasLocalChanges ? "#ffffff" : "#303030",
                    cursor: isSubmitting ? "default" : "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    minHeight: 36,
                    padding: "0 14px",
                  }}
                >
                  Review changes
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="publish"
                  disabled={isSubmitting || hasLocalChanges}
                  title={hasLocalChanges ? "Review changes before publishing to checkout." : ""}
                  style={{
                    background: hasLocalChanges ? "#f1f1f1" : "#303030",
                    border: "1px solid #303030",
                    borderRadius: 6,
                    color: hasLocalChanges ? "#6d7175" : "#ffffff",
                    cursor: isSubmitting || hasLocalChanges ? "default" : "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    minHeight: 36,
                    padding: "0 14px",
                  }}
                >
                  Publish reviewed rules
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="unpublish"
                  disabled={isSubmitting}
                  style={{
                    background: "#b42318",
                    border: "1px solid #b42318",
                    borderRadius: 6,
                    color: "#ffffff",
                    cursor: isSubmitting ? "default" : "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                    marginLeft: "auto",
                    minHeight: 36,
                    padding: "0 14px",
                  }}
                >
                  Unpublish campaigns
                </button>
              </div>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Compiled campaign summary">
        {campaignSummaries.length > 0 ? (
          <s-stack gap="base">
            <div
              style={{
                background: "linear-gradient(135deg, #f7fafc 0%, #fff7ed 100%)",
                border: "1px solid #d5dbe3",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <s-stack gap="base">
                <s-stack gap="small">
                  <s-text type="emphasis">Campaign inventory</s-text>
                  <s-text>
                    Search, scan by outcome type, then expand a group to inspect the campaigns that will run.
                  </s-text>
                </s-stack>
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  }}
                >
                  {["HideRates", "ShippingDiscount", "CartValidation"].map((type) => {
                    const visual = campaignVisual(type);
                    return (
                      <div
                        key={type}
                        style={{
                          background: visual.background,
                          border: `1px solid ${visual.border}`,
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              alignItems: "center",
                              background: visual.accent,
                              borderRadius: 99,
                              color: "#ffffff",
                              display: "inline-flex",
                              fontSize: 12,
                              fontWeight: 700,
                              height: 24,
                              justifyContent: "center",
                              lineHeight: 1,
                              width: 24,
                            }}
                          >
                            {visual.icon}
                          </span>
                          <div>
                            <div style={{ color: "#202223", fontSize: 13, fontWeight: 700 }}>{visual.label}</div>
                            <div style={{ color: "#5c5f62", fontSize: 12 }}>
                              {campaignTypeTotals[type]} campaign{campaignTypeTotals[type] === 1 ? "" : "s"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <input
                  aria-label="Search compiled campaigns"
                  placeholder="Search by code, tag, country, rate, message, or campaign name"
                  value={campaignSearch}
                  onChange={(event) => setCampaignSearch(event.target.value)}
                  style={{
                    border: "1px solid #c9cccf",
                    borderRadius: 6,
                    boxSizing: "border-box",
                    fontSize: 14,
                    minHeight: 38,
                    padding: "0 12px",
                    width: "100%",
                  }}
                />
              </s-stack>
            </div>

            {visibleCampaignGroups.map((group) => {
              const visual = campaignVisual(group.type);
              return (
                <details
                  key={group.type}
                  open={group.campaigns.length > 0}
                  style={{
                    background: visual.background,
                    border: `1px solid ${visual.border}`,
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <summary
                    style={{
                      alignItems: "center",
                      cursor: "pointer",
                      display: "flex",
                      gap: 12,
                      listStyle: "none",
                      padding: 14,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        alignItems: "center",
                        background: visual.accent,
                        borderRadius: 99,
                        color: "#ffffff",
                        display: "inline-flex",
                        fontSize: 12,
                        fontWeight: 700,
                        height: 26,
                        justifyContent: "center",
                        width: 26,
                      }}
                    >
                      {visual.icon}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ color: "#202223", display: "block", fontSize: 14, fontWeight: 700 }}>
                        {visual.label}
                      </span>
                      <span style={{ color: "#5c5f62", display: "block", fontSize: 12 }}>{group.description}</span>
                    </span>
                    <span
                      style={{
                        background: "#ffffff",
                        border: `1px solid ${visual.border}`,
                        borderRadius: 99,
                        color: visual.accent,
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "3px 8px",
                      }}
                    >
                      {group.campaigns.length}
                    </span>
                  </summary>
                  {group.campaigns.length > 0 ? (
                    <div style={{ borderTop: `1px solid ${visual.border}`, padding: 14 }}>
                      <div style={{ display: "grid", gap: 12 }}>
                        {group.campaigns.map((campaign, index) => (
                          <div
                            key={`${campaign.type}-${campaign.name}-${index}`}
                            style={{
                              background: "#ffffff",
                              border: "1px solid #dde0e4",
                              borderLeft: `4px solid ${visual.accent}`,
                              borderRadius: 8,
                              padding: 14,
                            }}
                          >
                            <s-stack gap="small">
                              <s-stack direction="inline" gap="base">
                                <s-text type="emphasis">{campaign.name}</s-text>
                                {campaignStatusElement(campaign)}
                              </s-stack>
                              <s-text>
                                <strong>When:</strong> {campaign.when}
                              </s-text>
                              <s-text>
                                <strong>Outcome:</strong> {campaign.outcome}
                              </s-text>
                              <s-text>
                                <strong>Affects:</strong> {campaign.affects}
                              </s-text>
                              <s-text>
                                <strong>Customer message:</strong> {campaign.customerMessage}
                              </s-text>
                              <s-text>
                                <strong>Dependencies:</strong>{" "}
                                {campaign.dependencies.length > 0 ? campaign.dependencies.join("; ") : "None"}
                              </s-text>
                              {campaign.risk.length > 0 ? (
                                <s-text>
                                  <strong>Check carefully:</strong> {campaign.risk.join("; ")}
                                </s-text>
                              ) : null}
                            </s-stack>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ borderTop: `1px solid ${visual.border}`, color: "#5c5f62", padding: 14 }}>
                      No compiled campaigns in this group.
                    </div>
                  )}
                </details>
              );
            })}

            {visibleCampaignSummaries.length === 0 ? (
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-text>No compiled campaigns match this search.</s-text>
              </s-box>
            ) : null}
          </s-stack>
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-text>No campaigns compiled. Publishing this ruleset clears active app-managed shipping rules.</s-text>
          </s-box>
        )}
      </s-section>

      <s-section heading="Technical output">
        <details
          style={{
            background: "#f6f8fa",
            border: "1px solid #d0d7de",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontWeight: 700,
              padding: 14,
            }}
          >
            Saved compiled JSON
          </summary>
          <pre
            style={{
              background: "#ffffff",
              borderTop: "1px solid #d0d7de",
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
        </details>
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
            <s-text>condition all means every qualifier must match.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>condition any creates one rule per qualifier.</s-text>
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
          Matching is case-insensitive. Product tags must be listed in settings.productTags before a campaign can use
          them.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="DSL examples">
        <s-stack gap="base">
          {DSL_EXAMPLES.map((example) => (
            <s-box key={example.title} padding="base" borderWidth="base" borderRadius="base">
              <s-stack gap="small">
                <s-text type="emphasis">{example.title}</s-text>
                <pre
                  style={{
                    background: "#f6f8fa",
                    border: "1px solid #d0d7de",
                    borderRadius: 6,
                    color: "#24292f",
                    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                    fontSize: 11,
                    lineHeight: 1.45,
                    margin: 0,
                    overflowX: "auto",
                    padding: 10,
                    whiteSpace: "pre",
                  }}
                >
                  {highlightDsl(example.code)}
                </pre>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
