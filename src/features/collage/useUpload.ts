"use client";

import { useCallback, useState } from "react";
import { uploadFiles, type ApiKey } from "@/features/collage/api";

/** Per-file upload progress (whole percents, in selection order) plus an `upload` action. */
export function useUpload(apiKey: ApiKey) {
  const [progress, setProgress] = useState<number[]>([]);

  const upload = useCallback(
    async (files: File[]): Promise<string[]> => {
      setProgress(files.map(() => 0));
      return uploadFiles(apiKey, files, setProgress);
    },
    [apiKey],
  );

  const reset = useCallback(() => setProgress([]), []);

  return { upload, progress, reset };
}
