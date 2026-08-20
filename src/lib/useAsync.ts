import { useState, useCallback, useEffect, useRef } from "react";

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

/** Thin wrapper over fetch lifecycle: data/loading/error. Skips update if unmounted. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> & { retry: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const mounted = useRef(true);

  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => { if (mounted.current) setState({ data, loading: false, error: null }); })
      .catch((e) => { if (mounted.current) setState({ data: null, loading: false, error: e?.message ?? "Failed" }); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { mounted.current = true; run(); return () => { mounted.current = false; }; }, [run]);

  return { ...state, retry: run };
}
