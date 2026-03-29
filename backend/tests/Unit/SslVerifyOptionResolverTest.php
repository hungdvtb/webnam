<?php

namespace Tests\Unit;

use App\Support\SslVerifyOptionResolver;
use Tests\TestCase;

class SslVerifyOptionResolverTest extends TestCase
{
    public function test_it_returns_false_when_ssl_verification_is_disabled(): void
    {
        $resolver = new SslVerifyOptionResolver();

        $result = $resolver->resolve(false, null, false, []);

        $this->assertFalse($result);
    }

    public function test_it_prefers_a_configured_ca_bundle_when_present(): void
    {
        $resolver = new SslVerifyOptionResolver();
        $bundlePath = tempnam(sys_get_temp_dir(), 'blog-ca-');
        $this->assertIsString($bundlePath);
        file_put_contents($bundlePath, 'test-ca-bundle');

        try {
            $result = $resolver->resolve(true, $bundlePath, false, []);

            $this->assertSame($bundlePath, $result);
        } finally {
            @unlink($bundlePath);
        }
    }

    public function test_it_falls_back_to_disabled_verification_only_in_local_without_any_bundle(): void
    {
        $resolver = new SslVerifyOptionResolver();

        $result = $resolver->resolve(true, null, true, []);

        $this->assertFalse($result);
    }

    public function test_it_keeps_ssl_verification_enabled_outside_local_when_no_bundle_exists(): void
    {
        $resolver = new SslVerifyOptionResolver();

        $result = $resolver->resolve(true, null, false, []);

        $this->assertTrue($result);
    }
}
