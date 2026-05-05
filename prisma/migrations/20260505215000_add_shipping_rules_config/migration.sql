CREATE TABLE "ShippingRulesConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "rulesJson" TEXT NOT NULL,
    "publishedJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ShippingRulesConfig_shop_key" ON "ShippingRulesConfig"("shop");
