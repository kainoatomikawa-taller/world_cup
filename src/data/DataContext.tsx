import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { fetchManifest } from './api';

interface DataContextValue {
  /** SHA-256 content hash from the manifest; null until manifest loads. */
  contentHash: string | null;
  /** ISO-8601 timestamp of the last pipeline run; null until manifest loads. */
  lastUpdated: string | null;
  /** True once the manifest fetch has settled (success or error). */
  manifestReady: boolean;
}

const DataContext = createContext<DataContextValue>({
  contentHash: null,
  lastUpdated: null,
  manifestReady: false,
});

export function DataProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<DataContextValue>({
    contentHash: null,
    lastUpdated: null,
    manifestReady: false,
  });

  useEffect(() => {
    fetchManifest()
      .then((m) => {
        setValue({
          contentHash: m.content_hash,
          lastUpdated: m.generated_at,
          manifestReady: true,
        });
      })
      .catch(() => {
        // Manifest unavailable — hooks will still fetch using unversioned URLs.
        setValue({ contentHash: null, lastUpdated: null, manifestReady: true });
      });
  }, []);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useDataContext(): DataContextValue {
  return useContext(DataContext);
}
