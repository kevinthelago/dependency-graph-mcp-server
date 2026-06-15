// mod foo; → resolves to src/utils.rs
mod utils;

// inline mod
mod helpers {
    pub fn help() {}
}

pub use utils::greet;
