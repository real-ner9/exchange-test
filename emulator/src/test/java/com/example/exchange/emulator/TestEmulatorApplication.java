package com.example.exchange.emulator;

import org.springframework.boot.SpringApplication;

public class TestEmulatorApplication {

	public static void main(String[] args) {
		SpringApplication.from(EmulatorApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
