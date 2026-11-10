import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Nastavi workerSrc lokalno z varnostnim fallbackom na CDN glede na različico pdfjsLib
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    pdfWorkerUrl ||
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
} catch {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export interface RenderedPdfPage {
  pageNumber: number;
  blob: Blob;
  dataUrl: string;
}

/**
 * Stisne poljuben slikovni Blob ali File v optimiziran JPEG Base64 data URL
 * (največja širina 1280px, kvaliteta 0.7), primeren za neposredno shranjevanje v bazo,
 * če Supabase Storage ni dosegljiv.
 */
export async function compressImageBlobToDataUrl(
  blob: Blob,
  maxWidth: number = 1280,
  quality: number = 0.7
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(objectUrl);
        let width = img.width || 1280;
        let height = img.height || 720;

        if (width > maxWidth) {
          const ratio = maxWidth / width;
          width = Math.round(maxWidth);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('2D platno ni na voljo.');
        }

        // Belo ozadje za prozorne PNG slike
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Fallback na navaden FileReader
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Napaka pri branju slike v Base64.'));
      reader.readAsDataURL(blob);
    };
    img.src = objectUrl;
  });
}

/**
 * Pretvori vsako stran PDF datoteke v optimizirano JPEG sliko (max širina 1280px, kvaliteta 0.7) v brskalniku.
 */
export async function convertPdfToImages(
  file: File,
  onProgress?: (current: number, total: number) => void,
  format: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<RenderedPdfPage[]> {
  const arrayBuffer = await file.arrayBuffer();
  let pdfDocument: pdfjsLib.PDFDocumentProxy;

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdfDocument = await loadingTask.promise;
  } catch {
    // Če lokalni worker ne uspe, preklopi na uradni CDN worker in poskusi znova
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const fallbackBuffer = await file.arrayBuffer();
    const retryTask = pdfjsLib.getDocument({ data: fallbackBuffer });
    pdfDocument = await retryTask.promise;
  }

  const numPages = pdfDocument.numPages;
  const results: RenderedPdfPage[] = [];
  const MAX_WIDTH = 1280;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (onProgress) {
      onProgress(pageNum, numPages);
    }

    // Prepusti glavno nit brskalnika za posodobitev UI-ja, da ne zmrzne
    await new Promise((r) => setTimeout(r, 15));

    const page = await pdfDocument.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const targetScale =
      unscaledViewport.width > 0
        ? Math.min(2.0, MAX_WIDTH / unscaledViewport.width)
        : 1.5;
    const viewport = page.getViewport({ scale: targetScale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Brskalnik ne podpira 2D platna (canvas) za izris PDF-ja.');
    }

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;

    const quality = 0.7;
    const dataUrl = canvas.toDataURL(format, quality);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error(`Napaka pri pretvorbi strani ${pageNum} v sliko.`));
        },
        format,
        quality
      );
    });

    results.push({
      pageNumber: pageNum,
      blob,
      dataUrl,
    });
  }

  return results;
}

