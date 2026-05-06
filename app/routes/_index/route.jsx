import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>HH Shipping Rules</h1>
        <p className={styles.text}>
          Internal shipping campaign tooling for Hey Harper stores.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Hide rates</strong>. Hide delivery options based on discount
            codes, cart conditions, item tags, and shipping destination.
          </li>
          <li>
            <strong>Shipping discounts</strong>. Apply configured free or reduced
            shipping campaigns.
          </li>
          <li>
            <strong>Checkout validation</strong>. Block invalid shipping campaign
            combinations with customer-facing messages.
          </li>
        </ul>
      </div>
    </div>
  );
}
