declare module "heic-convert" {
  interface Options {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  }
  export default function convert(options: Options): Promise<ArrayBuffer>;
}
