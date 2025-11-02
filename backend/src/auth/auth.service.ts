import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { faker } from '@faker-js/faker';
import { Prisma, TransactionType } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  generateToken(user: { id: number; email: string }): string {
    return this.jwt.sign({
      sub: user.id,
      email: user.email,
    });
  }

  private async seedUserData(userId: number) {
    // Default pots for the user
    const pots = [
      { name: 'Savings', amount: 159, target: 2000, userId, color: 'green' },
      {
        name: 'Concert Ticket',
        amount: 110,
        target: 150,
        userId,
        color: 'yellow',
      },
      { name: 'Gift', amount: 40, target: 60, userId, color: 'cyan' },
      { name: 'New Laptop', amount: 10, target: 1000, userId, color: 'navy' },
      { name: 'Holiday', amount: 531, target: 1440, userId, color: 'red' },
    ];

    // Default budgets for the user
    const budgets = [
      { category: 'Entertainment', amount: 750, userId, color: 'green' },
      { category: 'Bills', amount: 750, userId, color: 'yellow' },
      { category: 'Groceries', amount: 75, userId, color: 'cyan' },
      { category: 'Dining Out', amount: 75, userId, color: 'navy' },
      { category: 'Personal Care', amount: 100, userId, color: 'red' },
      { category: 'Transportation', amount: 120, userId, color: 'purple' },
    ];

    // Create some bills for the user
    const payees = [
      'Netflix',
      'Spotify',
      'Amazon',
      'AT&T',
      'Verizon',
      'Apple',
      'Google',
      faker.company.name(),
      faker.company.name(),
    ];

    const allUsers = await this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: userId } }, // Exclude current user
          { name: { not: 'admin' } }, // Exclude admin user
        ],
      },
      take: 10, // Limit to 10 random users
      orderBy: { id: 'asc' }, // For consistency in testing
    });

    // If no other users exist, create some sample counterparties
    const counterparties = allUsers.length > 0 ? allUsers : [];

    // Create array to hold all promises
    const allPromises = [
      // Create pots and budgets
      this.prisma.pot.createMany({ data: pots }),
      this.prisma.budget.createMany({ data: budgets }),

      // Create some bills for the user
      this.prisma.bill.createMany({
        data: Array.from({ length: 5 }).map(() => {
          const type = faker.helpers.arrayElement(['MONTHLY', 'ONETIME']);
          return {
            status: faker.helpers.arrayElement(['PAID', 'DUE', 'UPCOMING']),
            type,
            amount: Number(faker.finance.amount({ min: 20, max: 200, dec: 2 })),
            payee: faker.helpers.arrayElement(payees),
            dueDay:
              type === 'MONTHLY' ? faker.number.int({ min: 1, max: 28 }) : null,
            dueExactDate:
              type === 'ONETIME' ? faker.date.future({ years: 1 }) : null,
            userId,
          };
        }),
      }),
    ];

    // Add transaction creation promises if we have counterparties
    if (counterparties.length > 0) {
      // Create transactions for each counterparty
      const transactionsData: Prisma.TransactionCreateManyInput[] = [];

      for (let i = 0; i < Math.min(100, counterparties.length * 10); i++) {
        const counterparty = faker.helpers.arrayElement(counterparties);
        const isOutgoing = Math.random() > 0.5;

        transactionsData.push({
          userId: userId,
          counterpartyId: counterparty.id,
          amount:
            faker.number.int({ min: 10, max: 1000 }) * (isOutgoing ? -1 : 1),
          date: faker.date.recent({ days: 30 }),
          description: faker.lorem.sentence(),
          type: isOutgoing
            ? TransactionType.OUTGOING
            : TransactionType.INCOMING,
          category: faker.helpers.arrayElement([
            'Food',
            'Shopping',
            'Transport',
            'Bills',
            'Entertainment',
          ]),
        });
      }

      // Add the createMany operation to promises
      allPromises.push(
        this.prisma.transaction.createMany({
          data: transactionsData,
        }),
      );
    }

    // Execute all database operations in parallel
    await Promise.all(allPromises);
  }

  async register(name: string, email: string, plainPassword: string) {
    const hash = await bcrypt.hash(plainPassword, 10);
    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        password: hash,
        balance: 123500.21,
        income: 13640,
        expenses: 9752.52,
      },
    });

    // Set up default data for the new user
    await this.seedUserData(user.id);

    return { id: user.id, email: user.email, name: user.name };
  }

  async login(email: string, plainPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(plainPassword, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    const token = this.generateToken(user);
    return { user: { id: user.id, email: user.email, name: user.name }, token };
  }
}
