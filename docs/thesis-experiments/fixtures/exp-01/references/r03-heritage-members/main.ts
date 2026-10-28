interface Repository {
  load(): string;
}

abstract class BaseRepo implements Repository {
  abstract load(): string;
}

class FileRepo extends BaseRepo {
  load(): string {
    return "file";
  }
}

class CachedRepo extends FileRepo implements Repository {
  origin?: Repository;

  load(): string {
    return this.origin ? this.origin.load() : super.load();
  }
}

export function makeRepo(cached: boolean): Repository {
  return cached ? new CachedRepo() : new FileRepo();
}

export function handlerFor(repo: FileRepo): () => string {
  const fn = repo.load;
  return fn;
}
