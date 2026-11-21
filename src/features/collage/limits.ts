/** Non-secret collage limits resolved on the server and passed to the client form as props. */
export interface CollageLimits {
  maxImages: number;
  maxImageUploadBytes: number;
  maxCanvasPixels: number;
  maxCanvasDimension: number;
}
