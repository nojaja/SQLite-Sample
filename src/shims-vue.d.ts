/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  __sqlEditorBridge: {
    getValue: () => string;
    setValue: (v: string) => void;
    runFormatMenuAction: () => Promise<void>;
  };
}


declare module '*.css' {
  const content: string
  export default content
}

declare module '*.scss' {
  const content: string
  export default content
}

