/** Reserve order on receipt; serialize editor activation while allowing document opens concurrently. */
export class SelectionOrder {
  private revision = 0;
  private activation: Promise<void> = Promise.resolve();

  next() { return ++this.revision; }
  isCurrent(revision: number) { return revision === this.revision; }

  async activate<T>(revision: number, action: () => Promise<T>): Promise<T | undefined> {
    let release!: () => void;
    const previous = this.activation;
    this.activation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!this.isCurrent(revision)) {return undefined;}
      const result = await action();
      return this.isCurrent(revision) ? result : undefined;
    } finally { release(); }
  }
}
