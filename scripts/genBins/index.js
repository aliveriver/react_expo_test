// scripts/genBins.js
const fs   = require("fs");
const path = require("path");
const process = require("process");

const cwd = process.cwd()

// ① 模型目录 —— 按自己项目结构改
const DIR = path.join(cwd, "assets", "model");

// ② 找到 model.json + 所有 .bin（按文件名排序）
const JSON_FILE = "model.json";
const BIN_FILES = fs.readdirSync(DIR)
  .filter(f => f.endsWith(".bin"))
  .sort((a,b) => a.localeCompare(b, undefined, { numeric:true }));

// ③ 生成 TypeScript 源码
const PREFIX = "../../assets/model/";
const OUTPUT = `
export const MODEL_JSON = require("${PREFIX}${JSON_FILE}");
export const BIN_FILES = [
  ${BIN_FILES.map((f) => `  require("${PREFIX}${f}")`).join(",\n")}
  ] as number[];

`;
fs.writeFileSync(path.join(cwd, "scripts/genBins", "out.ts"), OUTPUT);
console.log(`✅ yoloBins.ts written with ${BIN_FILES.length} shards`);



