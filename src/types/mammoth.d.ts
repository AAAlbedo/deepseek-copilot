declare module 'mammoth/mammoth.browser' {
  const mammoth: any;
  export default mammoth;
  export function extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}
