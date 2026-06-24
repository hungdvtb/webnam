<?php

namespace Tests\Unit;

use Tests\TestCase;

class R2FilesystemConfigurationTest extends TestCase
{
    public function test_r2_requests_use_ipv4_by_default(): void
    {
        $this->assertSame('v4', config('filesystems.disks.r2.http.force_ip_resolve'));
    }
}
