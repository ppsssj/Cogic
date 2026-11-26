/** The part of CSSStyleDeclaration this module uses, so it can be tested without a DOM. */
export type InlineStyle = {
  getPropertyValue(property: string): string;
  getPropertyPriority(property: string): string;
  setProperty(property: string, value: string, priority?: string): void;
  removeProperty(property: string): string;
};

export type InlineStyled = { style: InlineStyle };

/**
 * Runs `body`, which may change the given inline style properties, and puts every one of them
 * back afterwards, also when `body` throws at any point. Properties that had no inline value
 * are removed again.
 */
export async function withTemporaryStyles<T>(
  elements: readonly InlineStyled[],
  properties: readonly string[],
  body: () => Promise<T>,
): Promise<T> {
  const saved = elements.map((element) =>
    properties.map((property) => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    })),
  );
  try {
    return await body();
  } finally {
    elements.forEach((element, index) => {
      for (const { property, value, priority } of saved[index]) {
        if (value) {
          element.style.setProperty(property, value, priority);
        } else {
          element.style.removeProperty(property);
        }
      }
    });
  }
}
