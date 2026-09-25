import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      // Overly strict - flags common init patterns
      "react-hooks/set-state-in-effect": "off",
      // Common pattern in React apps
      "react-hooks/static-components": "warn",
      // Allow anonymous default exports for utils
      "import/no-anonymous-default-export": "off",
      // Flags Math.random() even in useMemo - too strict
      "react-hooks/purity": "off",
      // Flags useMemo/useCallback variable hoisting - too strict
      "react-hooks/immutability": "off",
    },
  },
];
