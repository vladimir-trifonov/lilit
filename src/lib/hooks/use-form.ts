"use client";

import { useState, useCallback, useRef } from "react";

export interface UseFormResult<T extends Record<string, unknown>> {
  values: T;
  setValue: <K extends keyof T>(key: K, value: T[K]) => void;
  setValues: (updates: Partial<T>) => void;
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
  save: () => Promise<void>;
  reset: (newInitial?: T) => void;
}

/**
 * Manages form state with dirty tracking and async save.
 *
 * @param initialValues Starting form values (also used by `reset()`)
 * @param onSave        Async function called on `save()`. Throw to surface an error.
 */
export function useForm<T extends Record<string, unknown>>(
  initialValues: T,
  onSave: (values: T) => Promise<void>,
): UseFormResult<T> {
  const [values, setValuesState] = useState<T>(initialValues);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialRef = useRef(initialValues);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const setValue = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValuesState((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }, []);

  const setValues = useCallback((updates: Partial<T>) => {
    setValuesState((prev) => ({ ...prev, ...updates }));
    setIsDirty(true);
  }, []);

  const save = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSaveRef.current(values);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [values]);

  const reset = useCallback((newInitial?: T) => {
    const target = newInitial ?? initialRef.current;
    initialRef.current = target;
    setValuesState(target);
    setIsDirty(false);
    setError(null);
  }, []);

  return { values, setValue, setValues, isDirty, isSaving, error, save, reset };
}
