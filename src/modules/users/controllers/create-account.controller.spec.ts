import { Test, type TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { CreateAccountController } from './create-account.controller';
import { AccountService } from '../services/account.service';
import { EmailVerificationService } from '@/modules/auth/services/email-verification.service';

describe('CreateAccountController', () => {
  let controller: CreateAccountController;
  let accountService: AccountService;

  const mockAccountService = {
    create: jest.fn(),
    findByEmail: jest.fn(),
  };

  const mockEmailVerificationService = {
    createVerificationToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CreateAccountController],
      providers: [
        {
          provide: AccountService,
          useValue: mockAccountService,
        },
        {
          provide: EmailVerificationService,
          useValue: mockEmailVerificationService,
        },
      ],
    }).compile();

    controller = module.get<CreateAccountController>(CreateAccountController);
    accountService = module.get<AccountService>(AccountService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handle', () => {
    const validAccountData = {
      name: 'John Doe',
      email: 'john@example.com',
      password: 'Password123',
    };

    it('should create account with valid data', async () => {
      mockAccountService.findByEmail.mockResolvedValue(null);
      mockAccountService.create.mockResolvedValue({ id: 1, name: 'John Doe', email: 'john@example.com' });
      mockEmailVerificationService.createVerificationToken.mockResolvedValue(undefined);

      await controller.handle(validAccountData);

      expect(accountService.findByEmail).toHaveBeenCalledWith('john@example.com');
      expect(accountService.create).toHaveBeenCalledWith(validAccountData);
      expect(mockEmailVerificationService.createVerificationToken).toHaveBeenCalledWith(1, 'john@example.com', 'John Doe');
    });

    it('should throw error if account already exists', async () => {
      const existingAccount = { id: 1, email: 'john@example.com' };
      mockAccountService.findByEmail.mockResolvedValue(existingAccount);

      await expect(controller.handle(validAccountData)).rejects.toThrow(
        new HttpException('Account already exists', HttpStatus.BAD_REQUEST),
      );

      expect(accountService.findByEmail).toHaveBeenCalledWith('john@example.com');
      expect(accountService.create).not.toHaveBeenCalled();
    });

    it('should throw error with invalid email', async () => {
      const invalidData = {
        name: 'John Doe',
        email: 'invalid-email',
        password: 'Password123',
      };

      await expect(controller.handle(invalidData)).rejects.toThrow();
    });

    it('should throw error with short password', async () => {
      const invalidData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: '123',
      };

      await expect(controller.handle(invalidData)).rejects.toThrow();
    });
  });
});