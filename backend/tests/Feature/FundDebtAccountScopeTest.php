<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\DebtSubject;
use App\Models\FinAccount;
use App\Models\FinCategory;
use App\Models\FinTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FundDebtAccountScopeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware();
    }

    public function test_fund_accounts_and_transactions_are_scoped_by_active_account(): void
    {
        [$accountA, $accountB] = $this->accounts();

        $fundAccountA = FinAccount::query()->create([
            'account_id' => $accountA->id,
            'name' => 'Cash A',
            'type' => 'cash',
            'initial_balance' => 0,
            'balance' => 100,
        ]);
        $fundAccountB = FinAccount::query()->create([
            'account_id' => $accountB->id,
            'name' => 'Cash B',
            'type' => 'cash',
            'initial_balance' => 0,
            'balance' => 200,
        ]);

        $categoryA = FinCategory::query()->create([
            'account_id' => $accountA->id,
            'name' => 'Income A',
            'type' => 'income',
            'sort_order' => 1,
        ]);
        $categoryB = FinCategory::query()->create([
            'account_id' => $accountB->id,
            'name' => 'Income B',
            'type' => 'income',
            'sort_order' => 1,
        ]);

        FinTransaction::query()->create([
            'account_id' => $accountA->id,
            'transaction_date' => '2026-07-04 08:00:00',
            'description' => 'A only',
            'fin_account_id' => $fundAccountA->id,
            'fin_category_id' => $categoryA->id,
            'type' => 'income',
            'amount' => 100,
            'balance_after' => 100,
        ]);
        FinTransaction::query()->create([
            'account_id' => $accountB->id,
            'transaction_date' => '2026-07-04 09:00:00',
            'description' => 'B only',
            'fin_account_id' => $fundAccountB->id,
            'fin_category_id' => $categoryB->id,
            'type' => 'income',
            'amount' => 200,
            'balance_after' => 200,
        ]);

        $this->withHeaders($this->headers($accountA))
            ->getJson('/api/finance/funds/accounts')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $fundAccountA->id);

        $this->withHeaders($this->headers($accountA))
            ->getJson('/api/finance/funds/transactions')
            ->assertOk()
            ->assertJsonPath('data.data.0.description', 'A only');

        $this->withHeaders($this->headers($accountB))
            ->postJson('/api/finance/funds/transactions', [
                'transaction_date' => '2026-07-04 10:00:00',
                'description' => 'Invalid cross-store write',
                'fin_account_id' => $fundAccountA->id,
                'fin_category_id' => $categoryA->id,
                'type' => 'income',
                'amount' => 10,
            ])
            ->assertStatus(422);
    }

    public function test_debt_subjects_and_generated_fund_transactions_are_scoped_by_active_account(): void
    {
        [$accountA, $accountB] = $this->accounts();

        $fundAccountA = FinAccount::query()->create([
            'account_id' => $accountA->id,
            'name' => 'Debt cash A',
            'type' => 'cash',
            'initial_balance' => 0,
            'balance' => 0,
        ]);
        $fundAccountB = FinAccount::query()->create([
            'account_id' => $accountB->id,
            'name' => 'Debt cash B',
            'type' => 'cash',
            'initial_balance' => 0,
            'balance' => 0,
        ]);

        $subjectA = DebtSubject::query()->create([
            'account_id' => $accountA->id,
            'name' => 'Creditor A',
            'interest_rate_percent' => 0,
            'initial_debt' => 0,
        ]);
        $subjectB = DebtSubject::query()->create([
            'account_id' => $accountB->id,
            'name' => 'Creditor B',
            'interest_rate_percent' => 0,
            'initial_debt' => 0,
        ]);

        $this->withHeaders($this->headers($accountA))
            ->getJson('/api/finance/debts/subjects')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $subjectA->id);

        $this->withHeaders($this->headers($accountB))
            ->getJson("/api/finance/debts/transactions/{$subjectA->id}")
            ->assertNotFound();

        $this->withHeaders($this->headers($accountB))
            ->postJson('/api/finance/debts/transactions', [
                'debt_subject_id' => $subjectA->id,
                'transaction_date' => '2026-07-04 10:00:00',
                'type' => 'borrow',
                'amount' => 500,
                'fin_account_id' => $fundAccountB->id,
            ])
            ->assertStatus(422);

        $this->withHeaders($this->headers($accountA))
            ->postJson('/api/finance/debts/transactions', [
                'debt_subject_id' => $subjectA->id,
                'transaction_date' => '2026-07-04 11:00:00',
                'type' => 'borrow',
                'amount' => 500,
                'fin_account_id' => $fundAccountA->id,
            ])
            ->assertOk()
            ->assertJsonPath('status', 'success');

        $this->assertDatabaseHas('debt_transactions', [
            'account_id' => $accountA->id,
            'debt_subject_id' => $subjectA->id,
            'amount' => 500,
        ]);
        $this->assertDatabaseHas('fin_transactions', [
            'account_id' => $accountA->id,
            'fin_account_id' => $fundAccountA->id,
            'amount' => 500,
        ]);
        $this->assertDatabaseMissing('fin_transactions', [
            'account_id' => $accountB->id,
            'fin_account_id' => $fundAccountA->id,
        ]);

        $this->assertSame(500.0, (float) $fundAccountA->fresh()->balance);
        $this->assertSame(0.0, (float) $fundAccountB->fresh()->balance);
        $this->assertSame($subjectB->id, DebtSubject::query()->where('account_id', $accountB->id)->value('id'));
    }

    public function test_goods_debt_increases_debt_without_creating_fund_transaction(): void
    {
        [$accountA] = $this->accounts();

        $fundAccountA = FinAccount::query()->create([
            'account_id' => $accountA->id,
            'name' => 'Cash A',
            'type' => 'cash',
            'initial_balance' => 1000,
            'balance' => 1000,
        ]);

        $subjectA = DebtSubject::query()->create([
            'account_id' => $accountA->id,
            'name' => 'Supplier A',
            'interest_rate_percent' => 0,
            'initial_debt' => 0,
        ]);

        $response = $this->withHeaders($this->headers($accountA))
            ->postJson('/api/finance/debts/transactions', [
                'debt_subject_id' => $subjectA->id,
                'transaction_date' => '2026-07-19 09:00:00',
                'type' => 'borrow',
                'amount' => 750,
                'note' => 'Nhap hang chua tra tien',
                'skip_finance_transaction' => true,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('data.fin_account_id', null)
            ->assertJsonPath('data.fin_transaction_id', null);

        $this->assertDatabaseHas('debt_transactions', [
            'account_id' => $accountA->id,
            'debt_subject_id' => $subjectA->id,
            'fin_account_id' => null,
            'fin_transaction_id' => null,
            'amount' => 750,
        ]);

        $this->assertSame(0, FinTransaction::query()->where('account_id', $accountA->id)->count());
        $this->assertSame(1000.0, (float) $fundAccountA->fresh()->balance);

        $subjectsResponse = $this->withHeaders($this->headers($accountA))
            ->getJson('/api/finance/debts/subjects')
            ->assertOk();

        $this->assertSame(750.0, (float) $subjectsResponse->json('data.0.remaining_debt'));

        $transactionsResponse = $this->withHeaders($this->headers($accountA))
            ->getJson("/api/finance/debts/transactions/{$subjectA->id}")
            ->assertOk();

        $this->assertTrue($transactionsResponse->json('data.0.is_goods_debt'));
    }

    /**
     * @return array{0: Account, 1: Account}
     */
    private function accounts(): array
    {
        return [
            Account::query()->create(['name' => 'Store A', 'status' => true]),
            Account::query()->create(['name' => 'Store B', 'status' => true]),
        ];
    }

    private function headers(Account $account): array
    {
        return ['X-Account-Id' => (string) $account->id];
    }
}
