package com.example.exchange.appapi;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class AppApiApplicationTests {

	@Test
	void contextLoads() {
	}

}
