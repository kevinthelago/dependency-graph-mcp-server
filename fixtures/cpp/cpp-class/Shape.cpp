#include "Shape.hpp"
#include <cmath>
#include <utility>

namespace geometry {

Shape::Shape(std::string name) : name_(std::move(name)) {}

const std::string& Shape::name() const {
    return name_;
}

Circle::Circle(double radius) : Shape("Circle"), radius_(radius) {}

double Circle::area() const {
    return M_PI * radius_ * radius_;
}

double Circle::perimeter() const {
    return 2.0 * M_PI * radius_;
}

} // namespace geometry
