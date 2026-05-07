import {
  compileProductionRuleFile,
  displayPath,
  missingProductionRuleFiles,
  productionRuleFiles,
  productionRuleFindings,
  summarizeConfig,
} from "./production-rules-shared.mjs";

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Usage: npm run validate:production-rules -- [options]

Options:
  --store <shop.myshopify.com>  Validate one production store DSL.
  --json                       Print machine-readable JSON.
  --strict                     Treat warnings as failures.
  --no-snapshots               Skip golden snapshot comparison.
  --help                       Show this help.
`);
}

const options = {
  store: argValue("--store"),
  json: hasArg("--json"),
  strict: hasArg("--strict"),
  checkSnapshots: !hasArg("--no-snapshots"),
};

if (hasArg("--help")) {
  usage();
  process.exit(0);
}

const allRuleFiles = productionRuleFiles();
const missingStores = missingProductionRuleFiles(allRuleFiles);
const selectedRuleFiles = options.store
  ? allRuleFiles.filter((ruleFile) => ruleFile.store === options.store)
  : allRuleFiles;

const results = [];

if (options.store && selectedRuleFiles.length === 0) {
  results.push({
    store: options.store,
    file: null,
    summary: null,
    findings: [
      {
        level: "failure",
        message: `No production DSL file found for ${options.store}.`,
      },
    ],
  });
}

if (!options.store) {
  for (const store of missingStores) {
    results.push({
      store,
      file: null,
      summary: null,
      findings: [
        {
          level: "failure",
          message: `Required production DSL file is missing for ${store}.`,
        },
      ],
    });
  }
}

for (const ruleFile of selectedRuleFiles) {
  try {
    const compiled = compileProductionRuleFile(ruleFile);
    results.push({
      store: ruleFile.store,
      file: displayPath(ruleFile.path),
      snapshot: displayPath(ruleFile.snapshotPath),
      summary: summarizeConfig(compiled.config),
      findings: productionRuleFindings(compiled, options),
    });
  } catch (error) {
    results.push({
      store: ruleFile.store,
      file: displayPath(ruleFile.path),
      summary: null,
      findings: [
        {
          level: "failure",
          message: error.message,
        },
      ],
    });
  }
}

const failures = results.flatMap((result) => result.findings.filter((finding) => finding.level === "failure"));
const warnings = results.flatMap((result) => result.findings.filter((finding) => finding.level === "warning"));
const passed = failures.length === 0 && (!options.strict || warnings.length === 0);

if (options.json) {
  console.log(
    JSON.stringify(
      {
        passed,
        strict: options.strict,
        checkSnapshots: options.checkSnapshots,
        results,
        totals: {
          failures: failures.length,
          warnings: warnings.length,
        },
      },
      null,
      2,
    ),
  );
} else {
  for (const result of results) {
    console.log(`\n${result.store}`);
    if (result.file) console.log(`  file: ${result.file}`);
    if (result.snapshot && options.checkSnapshots) console.log(`  snapshot: ${result.snapshot}`);

    if (result.summary) {
      console.log(`  hide rules: ${result.summary.hideRules}`);
      console.log(`  shipping discounts: ${result.summary.shippingDiscounts}`);
      console.log(`  validations: ${result.summary.validations}`);
      console.log(`  product tags: ${result.summary.productTags.length ? result.summary.productTags.join(", ") : "none"}`);
    }

    const resultFailures = result.findings.filter((finding) => finding.level === "failure");
    const resultWarnings = result.findings.filter((finding) => finding.level === "warning");

    if (resultFailures.length > 0) {
      console.log("  failures:");
      for (const finding of resultFailures) {
        console.log(`    - ${finding.message}`);
      }
    }

    if (resultWarnings.length > 0) {
      console.log("  warnings:");
      for (const finding of resultWarnings) {
        console.log(`    - ${finding.message}`);
        for (const detail of finding.details ?? []) {
          console.log(`      * ${detail}`);
        }
      }
    }
  }

  if (passed) {
    console.log("\nProduction DSL validation passed.");
  } else if (options.strict && warnings.length > 0 && failures.length === 0) {
    console.error("\nProduction DSL validation failed because --strict treats warnings as failures.");
  } else {
    console.error("\nProduction DSL validation failed.");
  }
}

if (!passed) {
  process.exitCode = 1;
}
