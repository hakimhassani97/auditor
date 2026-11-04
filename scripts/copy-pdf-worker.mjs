import { copyFile, mkdir } from "node:fs/promises";
await mkdir("public", { recursive: true });
await copyFile("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
console.log("Copied PDF.js worker to public/pdf.worker.min.mjs");
