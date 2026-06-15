use super::Outer;

pub struct InnerType {
    pub value: i32,
}

impl InnerType {
    pub fn new(value: i32) -> Self {
        Self { value }
    }
}
