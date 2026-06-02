/// <reference types="vite/client" />
/// <reference types="chrome" />

import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          "auto-rotate"?: boolean | string;
          "camera-controls"?: boolean | string;
          "shadow-intensity"?: string;
          poster?: string;
          loading?: string;
        },
        HTMLElement
      >;
    }
  }
}
