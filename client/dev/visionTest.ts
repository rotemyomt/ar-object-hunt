import { vision } from "../src/vision/VisionEngine";
import { scoreAgainst, type ObjectSignature } from "@aoh/shared";

async function load(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}
async function run() {
  const t0 = performance.now();
  await vision.load();
  const loadMs = performance.now() - t0;
  const out: Record<string, unknown> = { loadMs: Math.round(loadMs), status: vision.current };
  const sigs: Record<string, ObjectSignature> = {};
  for (const name of ["coffee", "coffee-blue", "chelsea"]) {
    const c = await load(`/dev/${name}.png`);
    const times = [];
    let r;
    for (let i = 0; i < 3; i++) {
      r = await vision.detect(c, { embedLabels: "supported", maxEmbeds: 3, minScore: 0.35 });
      times.push(Math.round(r.detectMs));
    }
    out[name] = { detectMs: times, embedMs: Math.round(r!.embedMs), dets: r!.detections.map((d) => [d.label, +d.score.toFixed(2), !!d.embedding]) };
    const cup = r!.detections.find((d) => d.label === "cup" && d.embedding);
    if (cup) sigs[name] = { views: [{ embedding: cup.embedding!, color: cup.color! }] };
  }
  if (sigs.coffee && sigs["coffee-blue"]) {
    const v = sigs.coffee.views[0]!;
    out.selfScore = scoreAgainst(v, sigs.coffee);
    out.brownVsBlue = scoreAgainst(v, sigs["coffee-blue"]);
  }
  (window as unknown as { __result: unknown }).__result = out;
  document.getElementById("out")!.textContent = JSON.stringify(out, null, 2);
}
run().catch((e) => ((window as unknown as { __result: unknown }).__result = { error: String(e) }));
