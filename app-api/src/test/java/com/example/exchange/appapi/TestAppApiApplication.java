package com.example.exchange.appapi;

import org.springframework.boot.SpringApplication;

public class TestAppApiApplication {

	public static void main(String[] args) {
		SpringApplication.from(AppApiApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
