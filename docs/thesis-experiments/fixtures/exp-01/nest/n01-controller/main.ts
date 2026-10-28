import { Controller, Delete, Get, Post } from "@nestjs/common";

function findAll(): string[] {
  return [];
}

@Controller("users")
export class UsersController {
  @Get()
  list(): string[] {
    return findAll();
  }

  @Get(":id")
  show(): string {
    return this.format("x");
  }

  @Post()
  create(): string {
    return "created";
  }

  @Delete(":id")
  remove(): void {}

  private format(v: string): string {
    return v;
  }
}
