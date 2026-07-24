// Dynamically import heavy and browser-only libraries

export const processFile = async (file: File): Promise<{name: string, type: string, content: string}> => {
  const fileType = file.type;
  
  if (fileType.startsWith('image/')) {
    const base64 = await toBase64(file);
    return { name: file.name, type: fileType, content: base64 };
  } else if (fileType === 'application/pdf') {
    const text = await extractPdfText(file);
    return { name: file.name, type: 'pdf', content: text };
  } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const text = await extractWordText(file);
    return { name: file.name, type: 'docx', content: text };
  } else {
    throw new Error('Unsupported file type');
  }
};

const toBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

const extractPdfText = async (file: File): Promise<string> => {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((item: any) => item.str);
    fullText += strings.join(' ') + '\n';
  }
  
  return fullText;
};

const extractWordText = async (file: File): Promise<string> => {
  const mammoth = await import('mammoth/mammoth.browser');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};
