const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function loadSigning(environment, readCertificate) {
  const source = fs.readFileSync(path.join(__dirname, "../packages/signing/addDigitalSignature.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exported = {};
  vm.runInNewContext(compiled, {
    exports: exported,
    Buffer,
    process: { env: environment },
    require(name) {
      if (name === "fs") return { readFileSync: readCertificate };
      if (name === "pdf-lib") return { PDFDocument: { load() { throw new Error("PDF parsing reached"); } } };
      if (name === "./node-signpdf/dist/signpdf" || name === "./PDFArrayCustom") return {};
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return exported.addDigitalSignature;
}

test("signing requires a configured certificate before reading files or parsing a document", async () => {
  let reads = 0;
  const sign = loadSigning({}, () => { reads += 1; });
  await assert.rejects(sign(""), /CERT_FILE_PATH must point to a private signing certificate/);
  assert.equal(reads, 0);
});

test("signing reads only the configured private certificate path", async () => {
  const reads = [];
  const sign = loadSigning({ CERT_FILE_PATH: "/private/secrets/signing.p12" }, (file) => {
    reads.push(file);
    return Buffer.from("test certificate");
  });
  await assert.rejects(sign(""), /PDF parsing reached/);
  assert.deepEqual(reads, ["/private/secrets/signing.p12"]);
});

test("an unreadable configured certificate fails without a bundled fallback", async () => {
  const reads = [];
  const sign = loadSigning({ CERT_FILE_PATH: "/private/secrets/missing.p12" }, (file) => {
    reads.push(file);
    throw new Error("ENOENT");
  });
  await assert.rejects(sign(""), /ENOENT/);
  assert.deepEqual(reads, ["/private/secrets/missing.p12"]);
});
