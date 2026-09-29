"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";

/** GET our API with TanStack Query. The query key is the path. */
export function useApiQuery<T>(path: string | null) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path });
}

/** Human message for an API error code, with field-specific conflict messages where available. */
export function useErrorMessage() {
  const t = useTranslations("apiErrors");
  return (err: unknown): string => {
    if (!(err instanceof ApiError)) return t("server_error");
    const reason = (err.details?.reason ?? err.details?.field) as string | undefined;
    const specific = reason ? `${err.code}.${reason}` : null;
    if (specific && t.has(specific)) return t(specific);
    if (t.has(`${err.code}._`)) return t(`${err.code}._`);
    return t.has(err.code) ? t(err.code) : t("server_error");
  };
}

/**
 * Mutation with consistent UX: success toast, translated error toast, and invalidation of the given
 * query keys so lists refresh.
 */
export function useApiMutation<TBody, TResult = unknown>(
  fn: (body: TBody) => Promise<TResult>,
  opts: { invalidate?: QueryKey[]; success?: string; onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  const message = useErrorMessage();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(opts.success);
      for (const key of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(r);
    },
    onError: (err) => toast.error(message(err)),
  });
}

export { api };
