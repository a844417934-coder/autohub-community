// AutoHub data hooks extracted without external runtime integration.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export function useAsyncData(fetcher, deps = []) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [tick, setTick] = useState(0);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetcherRef.current().then((value) => {
            if (cancelled)
                return;
            setData(value);
            setLoading(false);
        }, (reason) => {
            if (cancelled)
                return;
            setError(reason instanceof Error ? reason : new Error(String(reason)));
            setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [tick, ...deps]);
    const refresh = useCallback(() => setTick((value) => value + 1), []);
    const update = useCallback((value) => {
        setData(value);
        setError(null);
        setLoading(false);
    }, []);
    return { data, loading, error, refresh, update };
}
export function usePolling(fetcher, onData, intervalMs, active) {
    const onDataRef = useRef(onData);
    onDataRef.current = onData;
    useEffect(() => {
        if (!active)
            return;
        let stopped = false;
        let timer;
        const run = async () => {
            if (stopped || document.hidden)
                return;
            try {
                const value = await fetcher();
                if (!stopped)
                    onDataRef.current(value);
            }
            catch {
            }
            finally {
                if (!stopped)
                    timer = setTimeout(run, intervalMs);
            }
        };
        const onVisibility = () => {
            if (!document.hidden) {
                if (timer)
                    clearTimeout(timer);
                run();
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        run();
        return () => {
            stopped = true;
            if (timer)
                clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [fetcher, intervalMs, active]);
}
