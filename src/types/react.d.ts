import "react";

declare module "react" {
  interface InputHTMLAttributes<T> {
    // Standard HTML attribute not yet included in the installed React types.
    writingsuggestions?: "true" | "false";
  }
}
