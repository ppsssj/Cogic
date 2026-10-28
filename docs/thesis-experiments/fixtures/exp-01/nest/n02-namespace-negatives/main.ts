import * as common from "@nestjs/common";
import { Get, Injectable } from "@nestjs/common";

@common.Controller()
export class HealthController {
  @common.Get("ping")
  ping(): string {
    return "pong";
  }

  @Get("status")
  status(): string {
    return this.ping();
  }

  helper(): string {
    return "h";
  }
}

@Injectable()
export class Service {
  @Get("ghost")
  ghost(): string {
    return "x";
  }
}

export class Plain {
  @Get("plain")
  handler(): string {
    return "y";
  }
}
