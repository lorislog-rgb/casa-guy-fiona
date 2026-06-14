import React from "react";
import ReactDOM from "react-dom/client";
import { ConversationProvider } from "@elevenlabs/react";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConversationProvider>
      <App />
    </ConversationProvider>
  </React.StrictMode>,
);
