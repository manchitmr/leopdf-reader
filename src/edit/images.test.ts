import * as mupdf from "mupdf";
import { expect, test } from "vitest";
import { EmbeddedFonts } from "./embedded-fonts";
import { deleteExistingImage, listExistingImages, takeExistingImage } from "./existing-images";
import { addImageObject, defaultImageRect, deleteObject, listObjects, moveObject, replaceObjectImage, resizeObject, type EditContext } from "./page-objects";

mupdf.setLog({ warning: () => {}, error: () => {} });

function image(w = 40, h = 20, gray = 90) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  pix.clear(gray);
  return new mupdf.Image(pix);
}

/** A page with two existing images drawn by the original content. */
function docWithImages() {
  const pdf = new mupdf.PDFDocument();
  const res = pdf.addObject(pdf.newDictionary());
  const xo = pdf.newDictionary();
  xo.put("Im1", pdf.addImage(image(40, 20, 50)));
  xo.put("Im2", pdf.addImage(image(30, 30, 200)));
  res.put("XObject", xo);
  pdf.insertPage(-1, pdf.addPage([0, 0, 595, 842], 0, res, "q 100 0 0 50 50 700 cm /Im1 Do Q q 60 0 0 60 300 500 cm /Im2 Do Q"));
  return pdf;
}
const ctxFor = (pdf: mupdf.PDFDocument): EditContext => ({ pdf, page: pdf.loadPage(0), fonts: new EmbeddedFonts(pdf) });
/** Every image drawn on page 0 (LeoPDF's own and original ones). */
function imageCount(pdf: mupdf.PDFDocument): number {
  let n = 0;
  pdf.loadPage(0).toStructuredText("preserve-images").walk({ onImageBlock: () => void n++ });
  return n;
}

test("existing images are listed with page-space rects", () => {
  const rects = listExistingImages(docWithImages().loadPage(0)).map((i) => i.rect.map(Math.round));
  expect(rects).toContainEqual([50, 92, 150, 142]);
  expect(rects).toContainEqual([300, 282, 360, 342]);
});

test("deleting an existing image removes only that image", () => {
  const pdf = docWithImages();
  deleteExistingImage(pdf.loadPage(0), [50, 92, 150, 142]);
  expect(listExistingImages(pdf.loadPage(0)).map((i) => i.rect.map(Math.round))).toEqual([[300, 282, 360, 342]]);
});

test("added images are objects: move, resize, replace, delete", () => {
  const pdf = new mupdf.PDFDocument();
  pdf.insertPage(-1, pdf.addPage([0, 0, 595, 842], 0, pdf.addObject(pdf.newDictionary()), ""));
  const ctx = ctxFor(pdf);
  const id = addImageObject(ctx, image(), [100, 100, 200, 150]);
  expect(listObjects(ctx.page)).toEqual([{ id, kind: "image", rect: [100, 100, 200, 150] }]);
  expect(imageCount(pdf)).toBe(1);
  moveObject(ctx, id, 10, 5);
  resizeObject(ctx, id, [110, 105, 310, 205]);
  expect(listObjects(ctx.page)[0].rect).toEqual([110, 105, 310, 205]);
  const drawn: number[][] = [];
  pdf.loadPage(0).toStructuredText("preserve-images").walk({ onImageBlock: (bbox) => void drawn.push(bbox.map(Math.round)) });
  expect(drawn).toEqual([[110, 105, 310, 205]]);
  expect(listExistingImages(pdf.loadPage(0))).toEqual([]); // LeoPDF's own images are listed as objects, not existing images
  replaceObjectImage(ctx, id, image(10, 10, 255));
  expect(imageCount(pdf)).toBe(1);
  deleteObject(ctx, id);
  expect(imageCount(pdf)).toBe(0);
});

test("taking an existing image returns it so it can become a movable object", () => {
  const pdf = docWithImages();
  const ctx = ctxFor(pdf);
  const img = takeExistingImage(ctx.page, [300, 282, 360, 342]);
  expect(img.getWidth()).toBe(30);
  expect(imageCount(pdf)).toBe(1);
  addImageObject(ctx, img, [300, 282, 360, 342]);
  expect(imageCount(pdf)).toBe(2);
});

test("default image rect keeps aspect ratio, fits the page and is centred", () => {
  const rect = defaultImageRect([0, 0, 595, 842], image(4000, 2000));
  expect(rect[2] - rect[0]).toBeLessThanOrEqual(595 * 0.8 + 0.01);
  expect((rect[2] - rect[0]) / (rect[3] - rect[1])).toBeCloseTo(2);
  expect((rect[0] + rect[2]) / 2).toBeCloseTo(297.5);
});
