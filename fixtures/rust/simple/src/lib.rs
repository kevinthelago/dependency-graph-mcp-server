use std::collections::HashMap;
use serde::Serialize;

pub struct Config {
    pub name: String,
}

pub fn create_config(name: String) -> Config {
    Config { name }
}

pub enum Status {
    Active,
    Inactive,
}

pub trait Describable {
    fn describe(&self) -> String;
}

type Alias = HashMap<String, String>;

const MAX_SIZE: usize = 100;

static GLOBAL_NAME: &str = "global";

macro_rules! make_it {
    ($x:expr) => {
        $x
    };
}
