const stringAttribute = (element, name) => {
  const attribute = element.attributes.find(
    (item) => item.type === "JSXAttribute" && item.name?.name === name
  );
  if (!attribute?.value) return undefined;
  if (attribute.value.type === "Literal" && typeof attribute.value.value === "string") {
    return attribute.value.value;
  }
  if (
    attribute.value.type === "JSXExpressionContainer" &&
    attribute.value.expression.type === "Literal" &&
    typeof attribute.value.expression.value === "string"
  ) {
    return attribute.value.expression.value;
  }
  return undefined;
};

const rules = {
  "no-img-element": {
    meta: {
      type: "suggestion",
      docs: { description: "Prefer next/image for application images" },
      messages: {
        useNextImage: "Use next/image instead of a raw <img> element, or document why native image behavior is required."
      },
      schema: []
    },
    create(context) {
      return {
        JSXOpeningElement(node) {
          if (node.name.type === "JSXIdentifier" && node.name.name === "img") {
            context.report({ node, messageId: "useNextImage" });
          }
        }
      };
    }
  },
  "no-html-link-for-pages": {
    meta: {
      type: "suggestion",
      docs: { description: "Prefer next/link for internal page navigation" },
      messages: {
        useNextLink: "Use next/link for internal navigation instead of a raw <a> element."
      },
      schema: []
    },
    create(context) {
      return {
        JSXOpeningElement(node) {
          if (node.name.type !== "JSXIdentifier" || node.name.name !== "a") return;
          if (node.attributes.some((attribute) => attribute.type === "JSXAttribute" && attribute.name?.name === "download")) return;
          const href = stringAttribute(node, "href");
          if (href && href.startsWith("/") && !href.startsWith("//")) {
            context.report({ node, messageId: "useNextLink" });
          }
        }
      };
    }
  }
};

export default { rules };
