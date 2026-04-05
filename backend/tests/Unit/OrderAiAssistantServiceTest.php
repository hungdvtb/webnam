<?php

namespace Tests\Unit;

use App\Services\Orders\OrderAiAssistantService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

class OrderAiAssistantServiceTest extends TestCase
{
    public function test_it_suggests_known_context_aliases_and_rule_key_for_training_preview(): void
    {
        $service = $this->makeService();

        $contextAliases = $this->invokePrivateMethod($service, 'suggestRuleContextAliases', ['ban 1m97, men lam', '']);
        $ruleKey = $this->invokePrivateMethod($service, 'suggestTrainingRuleKey', ['1m97', $contextAliases]);

        $this->assertSame(['men lam'], $contextAliases);
        $this->assertSame('1m97-men-lam', $ruleKey);
    }

    public function test_it_falls_back_to_short_context_phrase_when_no_known_qualifier_exists(): void
    {
        $service = $this->makeService();

        $contextAliases = $this->invokePrivateMethod($service, 'suggestRuleContextAliases', ['ban 1m97, hang ky', '']);
        $ruleKey = $this->invokePrivateMethod($service, 'suggestTrainingRuleKey', ['1m97', $contextAliases]);

        $this->assertSame(['hang ky'], $contextAliases);
        $this->assertSame('1m97-hang-ky', $ruleKey);
    }

    private function makeService(): OrderAiAssistantService
    {
        return (new ReflectionClass(OrderAiAssistantService::class))->newInstanceWithoutConstructor();
    }

    private function invokePrivateMethod(OrderAiAssistantService $service, string $method, array $arguments): mixed
    {
        $reflection = new ReflectionClass($service);
        $reflectionMethod = $reflection->getMethod($method);
        $reflectionMethod->setAccessible(true);

        return $reflectionMethod->invokeArgs($service, $arguments);
    }
}
