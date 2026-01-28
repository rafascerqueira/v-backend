import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { TestBaseModule } from "./test-base.module";
import type { CanActivate } from "@nestjs/common";

export const createUnitTestModule = (providers: any[] = []) => {
	return Test.createTestingModule({
		imports: [TestBaseModule],
		providers: providers,
	})
		.overrideGuard(JwtAuthGuard)
		.useValue({
			canActivate: jest.fn(() => true),
		} as CanActivate);
};
