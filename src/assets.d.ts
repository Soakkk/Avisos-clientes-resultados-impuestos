declare module "*.png" {
  const source: string;
  export default source;
}

interface Window {
  updates?: {
    check: () => Promise<boolean>;
    restart: () => Promise<boolean>;
    stateSaved: (requestId: string, success: boolean, message?: string) => void;
    onStatus: (callback: (status: import('./update-status').UpdateStatus) => void) => () => void;
    onSaveRequested: (callback: (requestId: string) => void) => () => void;
  };
}
