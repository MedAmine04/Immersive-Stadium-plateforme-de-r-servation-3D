import { expect, test } from "@playwright/test";

test("parcours : connexion, secteur, siège, vue, ajout, verrouillage", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill("fan@stadium.demo");
  await page.getByLabel(/mot de passe/i).fill("Fan#Stadium2026");
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  await page.waitForURL("/");
  await page.goto("/events/1");
  const svg = page.locator('svg[aria-label="Plan du stade"]');
  await expect(svg.locator("path").first()).toBeVisible();
  await svg.locator("path", { has: page.locator("title", { hasText: "S-L-01" }) }).first().click({ force: true });
  await page.waitForTimeout(8000);
  await page.mouse.click(520, 480);
  await page.getByText("Voir depuis ce siège").click();
  await expect(page.getByText(/vue depuis le siège/i)).toBeVisible();
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText(/1 \/ 8 places/)).toBeVisible();
  await expect(page.getByText(/verrouill/i).first()).toBeVisible();
});

test("la bannière de démonstration est toujours visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/aucun paiement réel/i)).toBeVisible();
});
