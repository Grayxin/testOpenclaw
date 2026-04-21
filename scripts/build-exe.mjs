import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT_DIR, "build");
const APP_DIR = path.join(BUILD_DIR, "app");

console.log("🚀 Starting ailit.exe build...");

// 1. Clean build dir
if (fs.existsSync(BUILD_DIR)) {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(APP_DIR, { recursive: true });

// 2. Copy dist/, assets/, docs/
console.log("📂 Copying dist, assets, docs...");
for (const dir of ["dist", "assets", "docs"]) {
  const src = path.join(ROOT_DIR, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(APP_DIR, dir), { recursive: true });
  }
}

// 3. Create a minimal package.json with only production dependencies
console.log("📝 Creating minimal package.json...");
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
const minimalPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  type: rootPkg.type,
  dependencies: rootPkg.dependencies,
};
fs.writeFileSync(path.join(APP_DIR, "package.json"), JSON.stringify(minimalPkg, null, 2));

// 4. Use npm (NOT pnpm) to install production deps in the isolated dir
console.log("📦 Installing production dependencies with npm...");
try {
  execSync("npm install --omit=dev --ignore-scripts --no-audit --no-fund", {
    cwd: APP_DIR,
    stdio: "inherit",
    env: { ...process.env, npm_config_node_linker: undefined },
  });
} catch (e) {
  console.warn("⚠️ npm install had warnings, continuing...");
}

// --- 新增：深度清理 node_modules ---
console.log("🧹 Aggressively cleaning node_modules to reduce size...");
const foldersToExclude = new Set([
  "test",
  "tests",
  "doc",
  "example",
  "examples",
  "scripts",
  "site",
  "website",
  "images",
]);
const extensionsToExclude = [
  ".md",
  ".ts",
  ".map",
  ".yml",
  ".yaml",
  ".json.gz",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
];

function cleanup(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (foldersToExclude.has(entry.name.toLowerCase()) || entry.name.startsWith(".")) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        cleanup(p);
      }
    } else {
      if (extensionsToExclude.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
        // Keep package.json and .node files
        if (entry.name !== "package.json" && !entry.name.endsWith(".node")) {
          fs.unlinkSync(p);
        }
      }
    }
  }
}
cleanup(path.join(APP_DIR, "node_modules"));

// 5. Embed node.exe
console.log("🔧 Embedding node.exe...");
fs.copyFileSync(process.execPath, path.join(APP_DIR, "node.exe"));

// 6. Report size before packaging
const getDirSize = (dir) => {
  let size = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(p);
    } else {
      try {
        size += fs.statSync(p).size;
      } catch (e) {
        // Ignore files that can't be accessed
        console.log("build app error e:{}", e);
      }
    }
  }
  return size;
};
const appSize = getDirSize(APP_DIR);
const appSizeMB = (appSize / 1024 / 1024).toFixed(1);
console.log(`📊 App directory size before packaging: ${appSizeMB} MB`);

// 7. Package with caxa
console.log("📦 Packaging into ailit.exe with caxa...");
try {
  const outputExe = path.join(ROOT_DIR, "ailit.exe");
  const caxaCmd = `npx caxa --input "${APP_DIR}" --output "${outputExe}" -- "{{caxa}}/node.exe" "{{caxa}}/dist/index.js"`;
  execSync(caxaCmd, { cwd: ROOT_DIR, stdio: "inherit" });
  const sizeMB = (fs.statSync(outputExe).size / 1024 / 1024).toFixed(1);
  console.log(`✅ ailit.exe created! Size: ${sizeMB} MB`);
} catch (e) {
  console.error("❌ Packaging failed:", e.message);
  process.exit(1);
}

// 8. Cleanup
console.log("🧹 Cleaning up...");
fs.rmSync(BUILD_DIR, { recursive: true, force: true });
console.log("🎉 Done! Double-click ailit.exe to run.");
