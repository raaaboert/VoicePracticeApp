"use client";

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";

import { safeTrainingContentMarkdownUrl } from "@/src/lib/trainingContentPresentation";

export function TrainingContentMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="training-content-markdown">
      <ReactMarkdown
        skipHtml
        urlTransform={(url) => safeTrainingContentMarkdownUrl(url) || defaultUrlTransform("")}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
