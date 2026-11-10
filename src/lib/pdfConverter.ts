import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RenderedPdfPage {
  pageNumber: number;
  blob: Blob;
  dataUrl: string;
}

/**
 * Pretvori vsako stran PDF datoteke v visoko-ločljivostno PNG/JPEG sliko v brskalniku.
 */
export async function convertPdfToImages(
  file: File,
  onProgress?: (current: number, total: number) => void,
  format: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<RenderedPdfPage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDocument = await loadingTask.promise;

  const numPages = pdfDocument.numPages;
  const results: RenderedPdfPage[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (onProgress) {
      onProgress(pageNum, numPages);
    }

    const page = await pdfDocument.getPage(pageNum);
    // Uporabimo scale 2.0 za ostre in čiste slajde na velikih zaslonih in telefonih
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Brskalnik ne podpira 2D platna (canvas) za izris PDF-ja.');
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error(`Napaka pri pretvorbi strani ${pageNum} v sliko.`));
        },
        format,
        0.92
      );
    });

    const dataUrl = canvas.toDataURL(format, 0.9);
    results.push({
      pageNumber: pageNum,
      blob,
      dataUrl,
    });
  }

  return results;
}
